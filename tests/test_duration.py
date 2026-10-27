"""Offline timed-load, guard evidence and data-only curl import regressions."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from http.cookiejar import CookieJar
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from server import Engine, Store, guard_headers, handler_for
import duration
from request_input import parse_input


class Provider(BaseHTTPRequestHandler):
    lock = threading.Lock()
    current = 0
    peak = 0
    calls = []
    def log_message(self, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with self.lock:
            ident = len(type(self).calls)
            record = {'start': time.perf_counter(), 'body': body}
            type(self).calls.append(record)
            type(self).current += 1
            type(self).peak = max(type(self).peak, type(self).current)
        name = body['model']
        try:
            self.send_response(500 if name == 'http-error' else 200)
            self.send_header('Content-Type', 'text/event-stream' if body['stream'] else 'application/json')
            if name != 'missing':
                self.send_header('X-VLLM-Empty-Guard', 'blocked' if name == 'blocked' else 'pass')
                self.send_header('X-VLLM-Empty-Guard-Attempts', '2' if name == 'retry' else '1')
                self.send_header('X-VLLM-Empty-Guard-Version', '2.3')
                self.send_header('X-VLLM-Empty-Guard-Policy', 'standard')
            self.end_headers()
            time.sleep(.3 if name == 'independent' and ident == 0 else .03)
            content = '' if name == 'empty' else 'Selam.'
            if body['stream']:
                self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': {'content': content, 'reasoning': 'Reasoning.'}, 'finish_reason': 'stop'}]}) + '\n\n').encode())
                if name != 'missing':
                    self.wfile.write(('data: ' + json.dumps({'choices': [], 'usage': {'prompt_tokens': 22, 'completion_tokens': 49}}) + '\n\n').encode())
                if name != 'truncated': self.wfile.write(b'data: [DONE]\n\n')
            else:
                self.wfile.write(json.dumps({'choices': [{'message': {'content': content, 'reasoning': 'Reasoning.'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 22, 'completion_tokens': 49}}).encode())
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): pass
        finally:
            record['end'] = time.perf_counter()
            with self.lock: type(self).current -= 1


def finish(engine, ident):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        run = engine.snapshot(ident)
        if run['status'] not in ('running', 'stopping'): return run
        time.sleep(.01)
    raise AssertionError('Timed run did not finish')


class InputTests(unittest.TestCase):
    def test_curl_heredoc_ignores_response_and_headers(self):
        text = "curl --noproxy '*' -N -i -sS --max-time 150 http://127.0.0.1:9098/v1/chat/completions \\\n-H 'Authorization: Bearer do-not-import' --data-binary @- <<'JSON'\n" + json.dumps({'model':'qwen38-flash-next-1', 'messages':[{'role':'user','content':'Selam'}], 'stream': True, 'chat_template_kwargs': {'enable_thinking': True, 'reasoning_effort':'medium'}}) + '\nJSON\nHTTP/1.1 200 OK\nx-vllm-empty-guard: pass\ndata: [DONE]'
        parsed = parse_input(text)
        self.assertEqual(parsed['timeout'], 150)
        self.assertEqual(parsed['payload']['chat_template_kwargs']['reasoning_effort'], 'medium')
        self.assertNotIn('do-not-import', json.dumps(parsed))
        self.assertEqual(parsed['url'], 'http://127.0.0.1:9098/v1/chat/completions')

    def test_inline_json_and_validation(self):
        payload = {'messages':[{'role':'user','content':'$(touch NEVER_EXECUTE)'}], 'stream':False}
        self.assertEqual(parse_input("curl http://localhost:8000/v1/chat/completions --data-raw '" + json.dumps(payload) + "'")['payload'], payload)
        for bad in ['curl http://localhost --data-binary @/etc/passwd', '{"messages":[]}', '{"messages":[{"role":"user","content":"x"}],"api_key":"secret"}']:
            with self.assertRaises(ValueError): parse_input(bad)

    def test_guard_unknown_attempts_not_zero_or_pass(self):
        headers = Message()
        headers['x-vllm-empty-guard'] = 'PASS'
        headers['x-vllm-empty-guard-attempts'] = 'not-a-number'
        self.assertEqual(guard_headers(headers)['result'], 'pass')
        self.assertIsNone(guard_headers(headers)['attempts'])
        self.assertIsNone(guard_headers(Message())['result'])


class DurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        threading.Thread(target=cls.provider.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls): cls.provider.shutdown(); cls.provider.server_close()
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.engine = Engine(self.store)
        self.model = self.store.save_model({'name': 'Local fixture', 'model': 'pass', 'base_url': f'http://127.0.0.1:{self.provider.server_port}', 'api_key':'local-secret'})
        self.config = {'model_id':self.model['id'], 'concurrency':2, 'duration_s':1, 'interval_s':.1, 'timeout':2, 'demo':False, 'payload':{'messages':[{'role':'user','content':'Selam'}], 'stream':True, 'max_tokens':1024, 'chat_template_kwargs':{'enable_thinking':True, 'reasoning_effort':'medium'}}}
        with Provider.lock: Provider.calls=[]; Provider.peak=0
    def tearDown(self): self.temp.cleanup()
    def run_case(self, name, **changes):
        self.store.save_model(self.model | {'model':name})
        run = duration.start(self.engine, self.config | changes)
        return finish(self.engine, run['id'])

    def test_independent_pacing_deadline_cap_and_payload(self):
        run = self.run_case('independent')
        self.assertEqual(run['status'], 'completed')
        self.assertTrue(run['summary']['all_success'])
        self.assertTrue(run['summary']['all_guard_pass'])
        self.assertEqual(Provider.peak, 2)
        self.assertLess(Provider.calls[2]['start'], Provider.calls[0]['end'])
        for lane in (1,2):
            rows = [r for r in run['requests'] if r['lane']==lane]
            for a,b in zip(rows,rows[1:]): self.assertGreaterEqual(b['start_offset_s']-a['end_offset_s'], .095)
        for row in run['requests']:
            self.assertLess(row['start_offset_s'], 1)
            self.assertEqual(row['guard']['attempts'], 1)
            self.assertEqual(row['text'], 'Selam.')
            self.assertEqual(row['reasoning'], 'Reasoning.')
            self.assertAlmostEqual(row['tokens_per_s'], 49/row['e2e_s'])
        self.assertEqual(Provider.calls[0]['body']['chat_template_kwargs'], self.config['payload']['chat_template_kwargs'])
        self.assertTrue(Provider.calls[0]['body']['stream_options']['include_usage'])
        self.assertEqual(self.store.get('duration_runs',run['id'])['summary'],run['summary'])
        self.assertNotIn('local-secret',json.dumps(run))
        self.assertEqual(len(duration.page(self.engine,run['id'],2,3)['requests']),3)
        self.assertNotIn('text',duration.page(self.engine,run['id'])['requests'][0])

    def test_eight_parallel_lanes(self):
        run = self.run_case('pass',concurrency=8,interval_s=1)
        self.assertEqual(len(run['requests']),8)
        self.assertEqual(Provider.peak,8)

    def test_retry_and_normal_json(self):
        run = self.run_case('retry',interval_s=1,payload=self.config['payload'] | {'stream':False})
        self.assertEqual(run['summary']['retried'],2)
        self.assertTrue(run['summary']['all_success'])
        self.assertEqual(run['requests'][0]['guard']['version'],'2.3')
        self.assertIsNone(run['requests'][0]['ttft_s'])

    def test_missing_headers_and_usage_are_unknown(self):
        run=self.run_case('missing',interval_s=1)
        self.assertTrue(run['summary']['all_success'])
        self.assertFalse(run['summary']['all_guard_pass'])
        self.assertEqual(run['summary']['guard_missing'],2)
        self.assertIsNone(run['requests'][0]['tokens_per_s'])
        self.assertIsNone(run['requests'][0]['output_tokens'])

    def test_empty_reasoning_only_truncation_http_error_and_nonpass(self):
        for name in ('empty','truncated','http-error','blocked'):
            run=self.run_case(name,interval_s=1)
            if name == 'blocked':
                self.assertTrue(run['summary']['all_success'])
                self.assertEqual(run['summary']['guard_other'],2)
            else:
                self.assertFalse(run['summary']['all_success'])
                self.assertEqual(run['summary']['failed'],2)
            if name == 'empty': self.assertEqual(run['summary']['empty'],2)
            if name == 'http-error': self.assertEqual(run['requests'][0]['http_status'],500)

    def test_stop_guard_and_restart_preserve_test(self):
        run=duration.start(self.engine,self.config | {'duration_s':60,'interval_s':2})
        with self.assertRaises(ValueError): duration.start(self.engine,self.config)
        time.sleep(.1)
        self.engine.stop(run['id'])
        result=finish(self.engine,run['id'])
        self.assertEqual(result['status'],'cancelled')
        self.assertFalse(result['summary']['all_success'])
        saved=self.store.get('duration_runs',run['id'])
        saved['status']='running'; saved['requests'][0]['status']='running'
        self.store.put('duration_runs',saved)
        restarted=Engine(Store(self.temp.name)).snapshot(run['id'])
        self.assertEqual(restarted['status'],'interrupted')
        self.assertEqual(restarted['requests'][0]['status'],'cancelled')

    def test_validation(self):
        for change in ({'concurrency':9},{'duration_s':0},{'interval_s':0},{'payload':self.config['payload'] | {'model':'different'}}):
            with self.assertRaises(ValueError): duration.start(self.engine,self.config | change)

    def test_authenticated_routes_and_export(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.engine))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{server.server_port}'
        op=build_opener(HTTPCookieProcessor(CookieJar()))
        def post(path, body): return json.load(op.open(Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})))
        try:
            with self.assertRaises(HTTPError) as unauthorized: op.open(base+'/api/duration-runs')
            unauthorized.exception.close()
            post('/api/login',{'username':'admin','password':'admin'})
            self.assertIn('payload',post('/api/request-input',{'text':json.dumps(self.config['payload'])}))
            run=post('/api/duration-runs',self.config | {'interval_s':1})
            finish(self.engine,run['id'])
            page=json.load(op.open(base+'/api/duration-runs/'+run['id']))
            self.assertEqual(page['summary']['completed'],2)
            row=json.load(op.open(base+'/api/duration-runs/'+run['id']+'/requests/0'))
            self.assertEqual(row['text'],'Selam.')
            exported=json.load(op.open(base+'/api/runs/'+run['id']+'/export?format=json'))
            self.assertEqual(exported['kind'],'duration')
            self.assertEqual(len(json.load(op.open(base+'/api/duration-runs'))),1)
        finally: server.shutdown(); server.server_close()

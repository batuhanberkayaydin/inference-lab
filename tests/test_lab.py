"""Small, offline regression suite; provider behavior comes from a local SSE fixture."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from http.cookiejar import CookieJar

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from server import Engine, Store, endpoint, handler_for, markdown_report, percentile, speculative_delta, summarize


class Fixture(BaseHTTPRequestHandler):
    lock = threading.Lock()
    current = 0
    peak = 0
    bodies = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with self.lock:
            type(self).bodies.append(body)
            type(self).current += 1
            type(self).peak = max(type(self).peak, type(self).current)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if not body.get('stream', True) or body['model'] == 'json-response' else 'text/event-stream')
        self.end_headers()
        try:
            if not body.get('stream', True) or body['model'] == 'json-response':
                time.sleep(.06)
                self.wfile.write(json.dumps({'choices': [{'message': {'content': 'Normal cevap'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 21, 'completion_tokens': 10}}).encode())
                return
            self.emit({'choices': [{'delta': {'role': 'assistant'}, 'finish_reason': None}]})
            if body['model'] == 'stall':
                time.sleep(1.4)
            else:
                time.sleep(.06)
            self.emit({'choices': [{'delta': {'content': 'Merhaba '}, 'finish_reason': None}]})
            time.sleep(.3 if body['model'] == 'live' else .04)
            self.emit({'choices': [{'delta': {'content': 'dünya'}, 'finish_reason': 'stop'}]})
            if body['model'] != 'no-usage':
                self.emit({'choices': [], 'usage': {'prompt_tokens': 21, 'completion_tokens': 10}})
            if body['model'] != 'truncated':
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with self.lock:
                type(self).current -= 1

    def emit(self, value):
        self.wfile.write(('data: ' + json.dumps(value) + '\n\n').encode())
        self.wfile.flush()


def await_report(engine, ident, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = engine.snapshot(ident)
        if run['status'] not in ('running', 'queued', 'stopping'):
            return run
        time.sleep(.01)
    raise AssertionError('Run did not finish within the test deadline')


class MetricsTests(unittest.TestCase):
    def test_percentile_interpolates_and_handles_empty(self):
        self.assertIsNone(percentile([], .95))
        self.assertAlmostEqual(percentile([1, 2, 3, 4], .95), 3.85)
        self.assertEqual(percentile([4], .95), 4)

    def test_throughput_uses_wall_time_and_successful_usage(self):
        rows = [{'status': 'completed', 'output_tokens': 100, 'input_tokens': 50, 'ttft_s': 1},
                {'status': 'completed', 'output_tokens': 200, 'input_tokens': 50, 'ttft_s': 2},
                {'status': 'failed', 'output_tokens': 900}]
        summary = summarize(rows, 10)
        self.assertEqual(summary['throughput'], 30)
        self.assertEqual(summary['output_tokens'], 300)
        self.assertEqual(summary['failed'], 1)

    def test_missing_usage_is_not_approximated(self):
        summary = summarize([{'status': 'completed', 'output_tokens': None, 'input_tokens': None, 'ttft_s': .1}], 2)
        self.assertIsNone(summary['throughput'])
        self.assertIsNone(summary['output_tokens'])
        self.assertIsNone(summary['input_tokens'])

    def test_speculative_counters_are_deltas(self):
        before = {'vllm:spec_decode_num_drafts_total': 10, 'vllm:spec_decode_num_draft_tokens_total': 30, 'vllm:spec_decode_num_accepted_tokens_total': 20}
        after = {k: v*2 for k,v in before.items()}
        values = speculative_delta(before, after)
        self.assertEqual(values['drafted_per_step'], 3)
        self.assertAlmostEqual(values['acceptance_pct'], 200/3)
        self.assertIsNone(speculative_delta(after, before)['acceptance_pct'])
        self.assertIsNone(speculative_delta({}, {})['drafted_per_step'])

    def test_endpoint_normalizes_v1(self):
        self.assertEqual(endpoint('http://localhost:8000/v1/'), 'http://localhost:8000/v1/chat/completions')
        self.assertEqual(endpoint('http://localhost:8000'), 'http://localhost:8000/v1/chat/completions')


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        threading.Thread(target=cls.provider.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.provider.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.provider.shutdown()
        cls.provider.server_close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.engine = Engine(self.store)
        self.model = self.store.save_model({'name': 'Fixture', 'provider': 'Test', 'model': 'fixture', 'base_url': self.base, 'api_key': 'test-only-secret'})
        self.config = {'prompts': ['bir', 'iki'], 'model_ids': [self.model['id']], 'demo': False, 'mode': 'concurrent', 'max_tokens': 32, 'temperature': 0, 'timeout': 3}
        with Fixture.lock:
            Fixture.peak = 0
            Fixture.bodies = []

    def tearDown(self):
        self.temp.cleanup()

    def run_config(self, **changes):
        run = self.engine.start(self.config | changes)
        return await_report(self.engine, run['id'])

    def test_normal_response_and_json_fallback(self):
        for stream, model_name in [(False, 'fixture'), (True, 'json-response')]:
            self.store.save_model(self.model | {'model': model_name})
            run = self.run_config(stream=stream)
            for row in run['phases'][0]['models'][0]['requests']:
                self.assertEqual(row['text'], 'Normal cevap')
                self.assertEqual(row['output_tokens'], 10)
                self.assertIsNone(row['ttft_s'])
                self.assertIsNone(row['stream_tps'])
                self.assertGreater(row['e2e_s'], 0)
            self.assertEqual(Fixture.bodies[-1]['stream'], stream)
            if not stream:
                self.assertNotIn('stream_options', Fixture.bodies[-1])

    def test_stream_text_is_visible_before_completion(self):
        self.store.save_model(self.model | {'model': 'live'})
        run = self.engine.start(self.config | {'prompts': ['bir']})
        deadline = time.monotonic() + 3
        observed = False
        while time.monotonic() < deadline:
            row = self.engine.snapshot(run['id'])['phases'][0]['models'][0]['requests'][0]
            if row['status'] == 'running' and row['text'] == 'Merhaba ':
                observed = True
                break
            time.sleep(.005)
        completed = await_report(self.engine, run['id'])
        self.assertTrue(observed)
        self.assertEqual(completed['phases'][0]['models'][0]['requests'][0]['text'], 'Merhaba dünya')

    def test_real_stream_usage_timing_and_persistence(self):
        run = self.run_config()
        self.assertEqual(run['status'], 'completed')
        target = run['phases'][0]['models'][0]
        self.assertEqual(target['summary']['output_tokens'], 20)
        for row in target['requests']:
            self.assertEqual(row['text'], 'Merhaba dünya')
            self.assertEqual(row['output_tokens'], 10)  # Two chunks are not two tokens.
            self.assertEqual(row['content_chunks'], 2)
            self.assertGreater(row['ttft_s'], .04)
            self.assertGreater(row['e2e_s'], row['ttft_s'])
            self.assertGreater(row['stream_tps'], 0)
        self.assertEqual(self.store.get('reports', run['id'])['status'], 'completed')
        self.assertIn('test-only-secret', self.store.cipher.decrypt(self.store.get('models',self.model['id'])['api_key'].encode()).decode())
        self.assertNotIn('test-only-secret', json.dumps(run))
        self.assertNotIn('api_key', json.dumps(self.store.public_models()))
        self.assertNotIn('test-only-secret', Path(self.temp.name, 'lab.sqlite3').read_bytes().decode(errors='ignore'))

    def test_serial_and_concurrent_use_identical_payloads(self):
        run = self.run_config(mode='compare', prompts=[str(i) for i in range(8)])
        self.assertEqual([p['name'] for p in run['phases']], ['serial', 'concurrent'])
        self.assertGreaterEqual(Fixture.peak, 2)
        bodies = Fixture.bodies
        self.assertEqual(len(bodies),16)
        serial = sorted(json.dumps(b,sort_keys=True) for b in bodies[:8])
        parallel = sorted(json.dumps(b,sort_keys=True) for b in bodies[8:])
        self.assertEqual(serial,parallel)
        self.assertGreater(run['phases'][0]['models'][0]['summary']['wall_s'],run['phases'][1]['models'][0]['summary']['wall_s'])

    def test_missing_usage_keeps_latency_but_not_token_speed(self):
        m = self.store.save_model(self.model | {'model': 'no-usage'})
        run = self.run_config(model_ids=[m['id']])
        target = run['phases'][0]['models'][0]
        self.assertEqual(run['status'], 'completed')
        self.assertIsNotNone(target['summary']['ttft_avg_s'])
        self.assertIsNone(target['summary']['throughput'])
        self.assertTrue(any('usage' in w for w in run['warnings']))

    def test_truncated_stream_is_failure(self):
        m = self.store.save_model(self.model | {'model':'truncated'})
        run = self.run_config(model_ids=[m['id']])
        self.assertEqual(run['status'],'partial')
        self.assertEqual(run['phases'][0]['models'][0]['summary']['completed'],0)
        self.assertIsNone(run['phases'][0]['models'][0]['summary']['throughput'])

    def test_timeout_interrupts_stalled_response(self):
        m = self.store.save_model(self.model | {'model':'stall'})
        run = self.run_config(model_ids=[m['id']], prompts=['one'], timeout=1)
        self.assertEqual(run['status'],'partial')
        self.assertLess(run['phases'][0]['models'][0]['requests'][0]['e2e_s'],1.3)

    def test_cancel_retains_partial_output_and_report(self):
        run = self.engine.start(self.config | {'demo':True})
        time.sleep(.5)
        self.engine.stop(run['id'])
        final = await_report(self.engine,run['id'])
        self.assertEqual(final['status'],'cancelled')
        self.assertTrue(any(r['text'] for r in final['phases'][0]['models'][0]['requests']))
        self.assertEqual(self.store.get('reports',run['id'])['status'],'cancelled')

    def test_validation_and_active_run_guard(self):
        for changes in ({'prompts': ['x']*9}, {'prompts':['']}, {'model_ids':['missing']}, {'max_tokens':0}, {'temperature':float('nan')}, {'mode':'single'}, {'model_ids':[self.model['id']]*2}):
            with self.assertRaises(ValueError):
                self.engine.start(self.config | changes)
        run=self.engine.start(self.config | {'demo':True})
        with self.assertRaises(ValueError):
            self.engine.start(self.config)
        self.engine.stop(run['id'])
        await_report(self.engine,run['id'])

    def test_four_models_eight_requests_supported(self):
        ids=[]
        for i in range(4):
            ids.append(self.store.save_model({'name':f'Test{i}','model':'fixture','base_url':self.base})['id'])
        run=self.run_config(model_ids=ids,prompts=['x']*8,model_schedule='parallel')
        self.assertEqual(run['status'],'completed')
        self.assertEqual(sum(m['summary']['completed'] for m in run['phases'][0]['models']),32)

    def test_http_auth_origin_and_exports(self):
        app=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.engine))
        threading.Thread(target=app.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{app.server_port}'
        client=build_opener(HTTPCookieProcessor(CookieJar()))
        def post(path,body,origin=None):
            headers={'Content-Type':'application/json'}
            if origin:headers['Origin']=origin
            return client.open(Request(base+path,json.dumps(body).encode(),headers))
        try:
            with self.assertRaises(HTTPError) as result:client.open(base+'/api/models')
            self.assertEqual(result.exception.code,401)
            result.exception.close()
            with self.assertRaises(HTTPError) as result:post('/api/login',{'username':'admin','password':'wrong'})
            result.exception.close()
            post('/api/login',{'username':'admin','password':'admin'}).close()
            self.assertNotIn('api_key',client.open(base+'/api/models').read().decode())
            with self.assertRaises(HTTPError) as result:post('/api/runs',self.config,'https://attacker.invalid')
            self.assertEqual(result.exception.code,403)
            result.exception.close()
            run=self.run_config()
            md=client.open(base+f'/api/runs/{run["id"]}/export?format=md').read().decode()
            self.assertIn('Ölçüm yöntemi',md)
            self.assertNotIn('test-only-secret',md)
            exported=json.loads(client.open(base+f'/api/runs/{run["id"]}/export?format=json').read())
            self.assertEqual(exported['id'],run['id'])
            csv=client.open(base+f'/api/runs/{run["id"]}/export?format=csv').read().decode()
            self.assertIn('ttft_s',csv)
            self.assertNotIn('test-only-secret',csv)
            post('/api/logout',{}).close()
            with self.assertRaises(HTTPError) as result:client.open(base+'/api/contexts')
            result.exception.close()
        finally:
            app.shutdown()
            app.server_close()

    def test_keys_survive_restart_and_blank_edit_keeps_them(self):
        encrypted=self.store.get('models',self.model['id'])['api_key']
        self.store.save_model(self.model | {'name':'Renamed','api_key':''})
        reloaded=Store(self.temp.name)
        self.assertEqual(reloaded.get('models',self.model['id'])['api_key'],encrypted)
        self.assertEqual(reloaded.cipher.decrypt(encrypted.encode()).decode(),'test-only-secret')
        self.store.save_model(self.model | {'clear_key':True})
        self.assertFalse(self.store.get('models',self.model['id'])['api_key'])


if __name__=='__main__':
    unittest.main()

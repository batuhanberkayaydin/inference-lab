"""Small, offline regression suite; provider behavior comes from a local SSE fixture."""
import json
import io
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError, URLError
from http.cookiejar import CookieJar

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import bundled_examples
from server import Engine, Store, endpoint, handler_for, markdown_report, percentile, speculative_delta, summarize


class FixtureServer(ThreadingHTTPServer):
    request_queue_size = 128


class Fixture(BaseHTTPRequestHandler):
    lock = threading.Lock()
    current = 0
    peak = 0
    bodies = []
    authorizations = []
    reset_results = []
    reset_calls = []
    reset_counts_at_inference = []
    barrier = threading.Event()
    barrier_count = 0

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path.endswith('/reset_prefix_cache'):
            with self.lock:
                type(self).reset_calls.append(self.path)
                success = type(self).reset_results.pop(0) if type(self).reset_results else True
            if success == '404':
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b'private-error-body')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': success}).encode())
            return
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with self.lock:
            type(self).reset_counts_at_inference.append(len(type(self).reset_calls))
            type(self).bodies.append(body)
            type(self).authorizations.append(self.headers.get('Authorization'))
            type(self).current += 1
            type(self).peak = max(type(self).peak, type(self).current)
            if body['model'] == 'barrier':
                type(self).barrier_count += 1
                if type(self).barrier_count == 48:
                    type(self).barrier.set()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json' if not body.get('stream', True) or body['model'] == 'json-response' else 'text/event-stream')
        self.end_headers()
        try:
            if body['model'] == 'barrier':
                type(self).barrier.wait(5)
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
        self.assertEqual(endpoint('http://localhost:8000/v1/chat/completions'), 'http://localhost:8000/v1/chat/completions')


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = FixtureServer(('127.0.0.1', 0), Fixture)
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
            Fixture.authorizations = []
            Fixture.reset_results = []
            Fixture.reset_calls = []
            Fixture.reset_counts_at_inference = []

    def tearDown(self):
        self.temp.cleanup()

    def run_config(self, **changes):
        run = self.engine.start(self.config | changes)
        return await_report(self.engine, run['id'])

    def test_reset_success_precedes_requests_and_each_compare_phase(self):
        ids = [self.store.save_model({'name': f'Model {i}', 'model': f'fixture-{i}', 'base_url': self.base, 'api_key': 'test-only-secret'})['id'] for i in range(2)]
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs:
            run = self.run_config(model_ids=ids, prompts=['x'], mode='compare', reset_prefix_cache=True, max_tokens=600, temperature=0.7, timeout=3)
        self.assertEqual(run['status'], 'completed')
        self.assertEqual(len(Fixture.reset_calls), 4)
        self.assertEqual([len(p['cache_resets']) for p in run['phases']], [2, 2])
        self.assertTrue(all(r['success'] for p in run['phases'] for r in p['cache_resets']))
        self.assertEqual(len(logs.records), 4)
        self.assertTrue(all(json.loads(r.getMessage())['success'] for r in logs.records))
        self.assertNotIn('test-only-secret', ''.join(logs.output))
        self.assertEqual(len(Fixture.bodies), 4)
        self.assertEqual(Fixture.reset_counts_at_inference, [2, 2, 4, 4])
        self.assertTrue(all(b['max_tokens'] == 600 and b['temperature'] == 0.7 for b in Fixture.bodies))
        self.assertEqual(run['config']['timeout'], 3)

    def test_reset_failure_aborts_before_any_inference(self):
        Fixture.reset_results = [False]
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs:
            run = self.run_config(prompts=['x'], reset_prefix_cache=True)
        self.assertEqual(run['status'], 'failed')
        self.assertEqual(Fixture.bodies, [])
        self.assertFalse(run['phases'][0]['cache_resets'][0]['success'])
        self.assertEqual(json.loads(logs.records[0].getMessage())['reason'], 'not_confirmed')
        self.assertTrue(any('sıfırlama' in w for w in run['warnings']))

    def test_reset_http_error_does_not_start_inference_or_log_body(self):
        Fixture.reset_results = ['404']
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs:
            run = self.run_config(prompts=['x'], reset_prefix_cache=True)
        self.assertEqual(run['status'], 'failed')
        self.assertEqual(Fixture.bodies, [])
        entry = json.loads(logs.records[0].getMessage())
        self.assertEqual((entry['success'], entry['http_status'], entry['reason']), (False, 404, 'http_error'))
        self.assertNotIn('private-error-body', ''.join(logs.output))

    def test_generation_defaults_match_for_each_model(self):
        ids = [self.store.save_model({'name': f'Model {i}', 'model': f'fixture-{i}', 'base_url': self.base})['id'] for i in range(2)]
        run = self.engine.start({'model_ids': ids, 'prompts': ['x'], 'mode': 'concurrent'})
        result = await_report(self.engine, run['id'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual((result['config']['max_tokens'], result['config']['temperature'], result['config']['timeout']), (512, 0, 120))
        self.assertEqual([(b['max_tokens'], b['temperature']) for b in Fixture.bodies], [(512, 0), (512, 0)])
        self.assertEqual(Fixture.reset_calls, [])

    def test_provider_http_failures_log_status_without_request_or_response_secrets(self):
        secret_prompt = 'private-prompt-not-for-logs'
        def fail(*args, **kwargs):
            raise HTTPError(self.base, 429, 'private-reason', {}, io.BytesIO(b'{"error":{"message":"private-provider-body"}}'))
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs, patch('server.build_opener') as opener:
            opener.return_value.open.side_effect = fail
            run = self.run_config(prompts=[secret_prompt])
        row = run['phases'][0]['models'][0]['requests'][0]
        self.assertEqual(row['http_status'], 429)
        self.assertIn('HTTP 429', row['error'])
        entry = json.loads(logs.records[0].getMessage())
        self.assertEqual((entry['run_id'], entry['phase'], entry['request'], entry['http_status']), (run['id'], 'concurrent', 1, 429))
        self.assertEqual((entry['category'], entry['stage'], entry['content_chunks']), ('http_error', 'waiting_for_headers', 0))
        self.assertNotIn(secret_prompt, logs.output[0])
        self.assertNotIn('test-only-secret', logs.output[0])
        self.assertNotIn('private-provider-body', logs.output[0])
        self.assertNotIn('private-reason', logs.output[0])

    def test_wrapped_timeout_is_logged_without_endpoint_or_secret(self):
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs, patch('server.build_opener') as opener:
            opener.return_value.open.side_effect = URLError(TimeoutError('secret-endpoint'))
            run = self.run_config(prompts=['bir'])
        self.assertEqual(json.loads(logs.records[0].getMessage())['category'], 'timeout')
        self.assertNotIn('secret-endpoint', logs.output[0])
        self.assertIn('zaman aşımı', run['phases'][0]['models'][0]['requests'][0]['error'])

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
        self.assertEqual('test-only-secret', self.store.credentials.read(self.store.get('models',self.model['id'])['api_key']))
        self.assertNotIn('test-only-secret', json.dumps(run))
        self.assertNotIn('api_key', json.dumps(self.store.public_models()))
        self.assertNotIn('test-only-secret', Path(self.temp.name, 'lab.sqlite3').read_bytes().decode(errors='ignore'))

    def test_serial_and_concurrent_use_identical_payloads(self):
        run = self.run_config(mode='compare', prompts=[str(i) for i in range(16)])
        self.assertEqual([p['name'] for p in run['phases']], ['serial', 'concurrent'])
        self.assertGreaterEqual(Fixture.peak, 2)
        bodies = Fixture.bodies
        self.assertEqual(len(bodies),32)
        serial = sorted(json.dumps(b,sort_keys=True) for b in bodies[:16])
        parallel = sorted(json.dumps(b,sort_keys=True) for b in bodies[16:])
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
        with self.assertLogs('inference_lab.requests', level='WARNING') as logs:
            run = self.run_config(model_ids=[m['id']], prompts=['one'], timeout=1)
        self.assertEqual(run['status'],'partial')
        self.assertLess(run['phases'][0]['models'][0]['requests'][0]['e2e_s'],1.3)
        self.assertEqual(json.loads(logs.records[0].getMessage())['category'], 'timeout')

    def test_cancel_retains_partial_output_and_report(self):
        live = self.store.save_model(self.model | {'model':'live'})
        run = self.engine.start(self.config | {'model_ids':[live['id']]})
        time.sleep(.15)
        self.engine.stop(run['id'])
        final = await_report(self.engine,run['id'])
        self.assertEqual(final['status'],'cancelled')
        self.assertTrue(any(r['text'] for r in final['phases'][0]['models'][0]['requests']))
        self.assertEqual(self.store.get('reports',run['id'])['status'],'cancelled')

    def test_validation_and_active_run_guard(self):
        for changes in ({'prompts': ['x']*25}, {'prompts':['']}, {'model_ids':['missing']}, {'max_tokens':0}, {'temperature':float('nan')}, {'mode':'single'}, {'model_ids':[self.model['id']]*2}):
            with self.assertRaises(ValueError):
                self.engine.start(self.config | changes)
        run=self.engine.start(self.config)
        with self.assertRaises(ValueError):
            self.engine.start(self.config)
        self.engine.stop(run['id'])
        await_report(self.engine,run['id'])

    def test_demo_runs_and_models_cannot_be_selected(self):
        with self.assertRaisesRegex(ValueError, 'Demo modu kaldırıldı'):
            self.engine.start(self.config | {'demo': True})
        legacy = self.store.get('models', self.model['id']) | {'id': 'old-demo', 'demo': True}
        self.store.put('models', legacy)
        self.assertNotIn('old-demo', [m['id'] for m in self.store.public_models()])
        self.assertIsNotNone(self.store.get('models', 'old-demo'))

    def test_four_models_twenty_four_requests_supported(self):
        ids=[]
        for i in range(4):
            ids.append(self.store.save_model({'name':f'Test{i}','model':'fixture','base_url':self.base})['id'])
        run=self.run_config(model_ids=ids,prompts=['x']*24,model_schedule='parallel')
        self.assertEqual(run['status'],'completed')
        self.assertEqual(sum(m['summary']['completed'] for m in run['phases'][0]['models']),96)

    def test_two_models_dispatch_24_each_without_waiting(self):
        Fixture.barrier.clear()
        Fixture.barrier_count = 0
        ids = [self.store.save_model({'name': f'Parallel {i}', 'model': 'barrier', 'base_url': self.base})['id'] for i in range(2)]
        run = self.engine.start(self.config | {'model_ids': ids, 'prompts': ['x'] * 24, 'timeout': 10})
        result = await_report(self.engine, run['id'], timeout=15)
        self.assertTrue(Fixture.barrier.is_set(), '48 requests must reach the provider before any can finish')
        self.assertEqual(Fixture.barrier_count, 48)
        self.assertEqual([m['summary']['completed'] for m in result['phases'][0]['models']], [24, 24])

    def test_http_auth_origin_and_exports(self):
        app=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.engine))
        threading.Thread(target=app.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{app.server_port}'
        client=build_opener(HTTPCookieProcessor(CookieJar()))
        def post(path,body,origin=None):
            headers={'Content-Type':'application/json'}
            if origin:headers['Origin']=origin
            return client.open(Request(base+path,json.dumps(body).encode(),headers))
        def delete(path):
            return client.open(Request(base+path,method='DELETE'))
        try:
            with self.assertRaises(HTTPError) as result:delete('/api/reports/'+'a'*16)
            self.assertEqual(result.exception.code,401)
            result.exception.close()
            with self.assertRaises(HTTPError) as result:client.open(base+'/api/models')
            self.assertEqual(result.exception.code,401)
            result.exception.close()
            with self.assertRaises(HTTPError) as result:post('/api/models/'+self.model['id']+'/test',{})
            self.assertEqual(result.exception.code,401)
            result.exception.close()
            with self.assertRaises(HTTPError) as result:post('/api/login',{'username':'admin','password':'wrong'})
            result.exception.close()
            post('/api/login',{'username':'admin','password':'admin'}).close()
            self.assertNotIn('api_key',client.open(base+'/api/models').read().decode())
            with post('/api/models/'+self.model['id']+'/test',{}) as response:
                check = json.load(response)
            self.assertTrue(check['ok'])
            self.assertNotIn('test-only-secret', json.dumps(check))
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
            long_prompt = bundled_examples.example('turkish-64k')['content']
            with post('/api/runs', self.config | {'prompts': [long_prompt] * 16}) as response:
                large_run = json.load(response)
            completed = await_report(self.engine, large_run['id'])
            self.assertEqual(completed['phases'][0]['models'][0]['summary']['completed'], 16)
            self.assertEqual(completed['config']['prompts'], [long_prompt] * 16)
            delete('/api/reports/'+run['id']).close()
            self.assertIsNone(self.engine.snapshot(run['id']))
            self.assertIsNone(self.store.get('reports',run['id']))
            self.assertIsNotNone(self.store.get('reports',completed['id']))
            with self.assertRaises(HTTPError) as result:delete('/api/reports/'+run['id'])
            self.assertEqual(result.exception.code,404)
            result.exception.close()
            post('/api/logout',{}).close()
            with self.assertRaises(HTTPError) as result:client.open(base+'/api/contexts')
            result.exception.close()
        finally:
            app.shutdown()
            app.server_close()

    def test_connection_check_uses_saved_model_and_sanitizes_failure(self):
        result = self.engine.test_model(self.model['id'])
        self.assertTrue(result['ok'])
        self.assertEqual(Fixture.authorizations[-1], 'Bearer test-only-secret')
        self.assertEqual(Fixture.bodies[-1]['model'], 'fixture')
        self.assertEqual(Fixture.bodies[-1]['max_tokens'], 1)
        self.assertFalse(Fixture.bodies[-1]['stream'])
        with patch('server.build_opener') as mocked:
            mocked.return_value.open.side_effect = HTTPError(self.base, 401, 'test-only-secret', {}, None)
            result = self.engine.test_model(self.model['id'])
        self.assertFalse(result['ok'])
        self.assertEqual(result['http_status'], 401)
        self.assertNotIn('test-only-secret', json.dumps(result))
        self.assertEqual(self.store.list('reports'), [])

    def test_keys_survive_restart_and_blank_edit_keeps_them(self):
        reference=self.store.get('models',self.model['id'])['api_key']
        self.store.save_model(self.model | {'name':'Renamed','api_key':''})
        reloaded=Store(self.temp.name)
        self.assertEqual(reloaded.get('models',self.model['id'])['api_key'],reference)
        self.assertEqual(reloaded.credentials.read(reference),'test-only-secret')
        self.store.save_model(self.model | {'clear_key':True})
        self.assertFalse(self.store.get('models',self.model['id'])['api_key'])

    def test_active_report_cannot_be_deleted(self):
        run = self.engine.start(self.config)
        with self.assertRaisesRegex(ValueError, 'Çalışan rapor silinemez'):
            self.engine.delete_report(run['id'])
        self.engine.stop(run['id'])
        await_report(self.engine, run['id'])

    def test_active_run_keeps_its_private_key_when_saved_model_key_is_removed(self):
        run = self.engine.start(self.config | {'mode': 'compare'})
        self.store.save_model(self.model | {'clear_key': True})
        self.assertEqual(list(self.store.credentials.directory.iterdir()), [])
        run = await_report(self.engine, run['id'])
        self.assertEqual(run['status'], 'completed')
        self.assertEqual(Fixture.authorizations, ['Bearer test-only-secret'] * 4)
        self.assertNotIn('test-only-secret', json.dumps(run))
        self.assertNotIn('test-only-secret', json.dumps(self.store.list('reports')))


if __name__=='__main__':
    unittest.main()

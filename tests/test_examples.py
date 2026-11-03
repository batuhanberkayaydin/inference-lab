"""Fresh deployments stay empty; bundled long prompts load only on request."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from server import Store, Engine, handler_for
import bundled_examples


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
    def tearDown(self): self.temp.cleanup()

    def test_fresh_store_has_no_automatic_mock_records(self):
        for table in ('models', 'contexts', 'inputs', 'reports', 'duration_runs'):
            self.assertEqual(self.store.list(table), [])
        self.assertEqual(Store(self.temp.name).list('models'), [])
        self.assertEqual(Store(self.temp.name).list('contexts'), [])

    def test_existing_data_is_preserved_and_deleted_models_do_not_return(self):
        model = self.store.save_model({'name':'User model', 'model':'user-model', 'base_url':'http://localhost:8000/v1', 'api_key':'fixture-only-key'})
        context = self.store.put('contexts', {'id':'user-context', 'name':'User context', 'content':'My text', 'category':''})
        saved = self.store.save_input({'name':'User input', 'context':'Do not change'})
        reloaded = Store(self.temp.name)
        self.assertEqual(reloaded.get('contexts', context['id']), context)
        self.assertEqual(reloaded.get('inputs', saved['id']), saved)
        self.assertTrue(reloaded.get('models', model['id'])['api_key'])
        reloaded.delete('models', model['id'])
        self.assertEqual(Store(self.temp.name).list('models'), [])

    def test_examples_are_exact_files_with_target_labels_and_light_summaries(self):
        summaries = bundled_examples.summaries()
        self.assertEqual([item['target_tokens'] for item in summaries], [32768, 65536])
        self.assertLess(len(json.dumps(summaries)), 2000)
        for item in summaries:
            self.assertNotIn('content', item)
            raw = (bundled_examples.DIRECTORY / item['filename']).read_bytes()
            detail = bundled_examples.example(item['id'])
            self.assertEqual(detail['content'].encode('utf-8'), raw)
            self.assertEqual(item['characters'], len(detail['content']))
            self.assertEqual(item['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertIn('tamamen kurgusaldır', detail['content'])
            self.assertIn('## Sorular', detail['content'])
        self.assertIsNone(bundled_examples.example('../data/credential.key'))
        self.assertEqual(self.store.list_inputs(), [])

    def test_authenticated_examples_can_be_loaded_without_creating_records(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(Engine(self.store)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        op = build_opener(HTTPCookieProcessor(CookieJar()))
        def get(path):
            with op.open(base + path) as response: return json.load(response)
        def post(path, body):
            with op.open(Request(base + path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})) as response: return json.load(response)
        try:
            with self.assertRaises(HTTPError) as error: get('/api/examples')
            self.assertEqual(error.exception.code, 401)
            error.exception.close()
            post('/api/login', {'username':'admin', 'password':'admin'})
            items = get('/api/examples')
            content = get('/api/examples/' + items[1]['id'])['content']
            self.assertEqual(content, bundled_examples.example('turkish-64k')['content'])
            for path in ('/api/models', '/api/contexts', '/api/inputs', '/api/reports', '/api/duration-runs'):
                self.assertEqual(get(path), [])
            saved = post('/api/inputs', {'name':items[1]['name'], 'context':content, 'target_tokens':65536})
            self.assertEqual(get('/api/inputs/' + saved['id'])['content'], content)
            with self.assertRaises(HTTPError) as error: get('/api/examples/not-an-example')
            self.assertEqual(error.exception.code, 404)
            error.exception.close()
        finally: server.shutdown(); server.server_close()

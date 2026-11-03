"""Dependency-free credentials: permissions, persistence, redaction and old DB safety."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from server import Engine, Store
import duration


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name)
        self.model_data = {'name': 'Fixture', 'model': 'fixture',
                           'base_url': 'http://localhost:8000/v1', 'api_key': 'fixture-api-secret'}

    def test_credentials_persist_outside_database_and_public_models(self):
        public = self.store.save_model(self.model_data)
        reference = self.store.get('models', public['id'])['api_key']
        self.assertTrue(self.store.credentials.is_reference(reference))
        self.assertEqual(Store(self.temp.name).credentials.read(reference), 'fixture-api-secret')
        self.assertNotIn('fixture-api-secret', json.dumps(public))
        self.assertNotIn(reference, json.dumps(public))
        self.assertNotIn(b'fixture-api-secret', self.store.db.read_bytes())
        self.assertFalse((Path(self.temp.name) / 'credential.key').exists())
        files = list(self.store.credentials.directory.glob('*.txt'))
        self.assertEqual(len(files), 1)
        if os.name == 'posix':
            self.assertEqual(self.store.credentials.directory.stat().st_mode & 0o777, 0o700)
            self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)

    def test_replacing_clearing_and_deleting_keys_remove_old_files(self):
        public = self.store.save_model(self.model_data)
        original = self.store.get('models', public['id'])['api_key']
        self.store.save_model(public | {'api_key': 'replacement-secret'})
        replacement = self.store.get('models', public['id'])['api_key']
        self.assertNotEqual(original, replacement)
        with self.assertRaisesRegex(ValueError, 'okunamadı'):
            self.store.credentials.read(original)
        self.assertEqual(len(list(self.store.credentials.directory.iterdir())), 1)
        self.store.save_model(public | {'clear_key': True})
        self.assertFalse(self.store.get('models', public['id'])['api_key'])
        self.assertEqual(list(self.store.credentials.directory.iterdir()), [])
        self.store.save_model(public | {'api_key': 'another-fixture-secret'})
        self.store.delete('models', public['id'])
        self.assertEqual(list(self.store.credentials.directory.iterdir()), [])

    def test_legacy_records_survive_and_request_explicit_key_reentry(self):
        legacy_key = Path(self.temp.name) / 'credential.key'
        legacy_key.write_bytes(b'legacy-key-fixture')
        public = self.store.save_model(self.model_data | {'api_key': ''})
        legacy = self.store.get('models', public['id']) | {'api_key': 'gAAAAA-legacy-ciphertext-fixture'}
        self.store.put('models', legacy)
        reloaded = Store(self.temp.name)
        self.assertEqual(reloaded.get('models', public['id']), legacy)
        self.assertEqual(legacy_key.read_bytes(), b'legacy-key-fixture')
        public = reloaded.public_models()[0]
        self.assertTrue(public['key_requires_reentry'])
        with self.assertRaisesRegex(ValueError, 'yeniden girip kaydedin'):
            reloaded.credentials.read(legacy['api_key'])
        engine = Engine(reloaded)
        with patch('server.build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'yeniden girip kaydedin'):
                engine.start({'prompts': ['fixture'], 'model_ids': [public['id']]})
            with self.assertRaisesRegex(ValueError, 'yeniden girip kaydedin'):
                duration.start(engine, {'model_id': public['id'], 'payload': {'messages': [{'role': 'user', 'content': 'fixture'}]}})
            opener.assert_not_called()
        self.assertEqual(reloaded.list('reports'), [])
        self.assertEqual(reloaded.list('duration_runs'), [])
        reloaded.save_model(public | {'api_key': ''})
        self.assertEqual(reloaded.get('models', public['id'])['api_key'], legacy['api_key'])
        reloaded.save_model(public | {'api_key': 'new-fixture-secret'})
        self.assertFalse(reloaded.public_models()[0]['key_requires_reentry'])
        self.assertEqual(legacy_key.read_bytes(), b'legacy-key-fixture')

    def test_bad_model_and_failed_database_write_leave_no_secret_files(self):
        with self.assertRaises(ValueError):
            self.store.save_model(self.model_data | {'base_url': 'invalid'})
        self.assertEqual(list(self.store.credentials.directory.iterdir()), [])
        public = self.store.save_model(self.model_data)
        before = list(self.store.credentials.directory.iterdir())
        with patch.object(self.store, 'put', side_effect=RuntimeError('fixture write failed')):
            with self.assertRaises(RuntimeError):
                self.store.save_model(public | {'api_key': 'uncommitted-secret'})
        self.assertEqual(list(self.store.credentials.directory.iterdir()), before)
        self.assertEqual(self.store.credentials.read(self.store.get('models', public['id'])['api_key']), 'fixture-api-secret')

    def test_invalid_missing_or_symlink_keys_fail_without_anonymous_fallback(self):
        for value in ('secret\nheader', 'secret\rheader', 'x' * 8193, True):
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(ValueError):
                    self.store.credentials.save(value)
        with self.assertRaises(ValueError):
            self.store.credentials.read('local-file-v1:../../outside')
        reference = self.store.credentials.save('fixture-api-secret')
        path = next(self.store.credentials.directory.iterdir())
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'okunamadı'):
            self.store.credentials.read(reference)
        if hasattr(os, 'O_NOFOLLOW'):
            outside = Path(self.temp.name) / 'outside.txt'
            outside.write_text('must-not-read')
            path.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'okunamadı'):
                self.store.credentials.read(reference)

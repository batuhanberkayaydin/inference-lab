"""Run inside the final image with --network none; never contact a provider."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

assert os.getuid() == 10001, 'Runtime must run as the lab user'
assert shutil.which('node') is None, 'Node belongs only in the build stage'
root = Path('/app')
assert '<html' in (root / 'dist/index.html').read_text().lower()
assert any((root / 'dist/assets').glob('*.js')), 'Compiled UI must be packaged'
sys.path.insert(0, str(root / 'backend'))
from bundled_examples import summaries
from server import Store

assert len(summaries()) == 2, 'Both optional prompt examples must be packaged'
with tempfile.TemporaryDirectory() as directory:
    store = Store(directory)
    for table in ('models', 'contexts', 'inputs', 'reports', 'duration_runs'):
        assert store.list(table) == [], f'Fresh {table} must be empty'
    token = store.cipher.encrypt(b'container-smoke-fixture')
    assert Store(directory).cipher.decrypt(token) == b'container-smoke-fixture'
    process = subprocess.Popen(
        [sys.executable, 'backend/server.py', '--host', '127.0.0.1', '--data-dir', directory],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 15
        while True:
            assert process.poll() is None, 'Packaged server exited during startup'
            try:
                with urlopen('http://127.0.0.1:8787/api/health', timeout=1) as response:
                    assert response.status == 200
                    assert json.load(response)['status'] == 'ok'
                break
            except URLError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
        with urlopen('http://127.0.0.1:8787/', timeout=3) as response:
            assert '<html' in response.read().decode().lower()
        try:
            urlopen('http://127.0.0.1:8787/api/models', timeout=3)
            raise AssertionError('Model API must require authentication')
        except HTTPError as error:
            assert error.code == 401
            error.close()
    finally:
        process.terminate()
        try:
            output = process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            output = process.communicate()[0]
        print(output.decode(), end='')
print('Packaged runtime OK: offline startup, encrypted storage, empty DB, UI and examples.')

"""Local inference workbench: encrypted credentials, streaming measurements, SQLite reports."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import concurrent.futures
import copy
import csv
import hashlib
import hmac
import io
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
import duration
from request_input import parse_input
from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
COLORS = ['#3f6eeb', '#dd693b', '#0b8b78', '#9772cc']


def now():
    return datetime.now(timezone.utc).isoformat()


def percentile(values, q):
    values = sorted(v for v in values if v is not None and math.isfinite(v))
    if not values:
        return None
    pos = (len(values) - 1) * q
    low = math.floor(pos)
    high = math.ceil(pos)
    return values[low] + (values[high] - values[low]) * (pos - low)


def average(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def valid_url(value, allow_empty=False):
    if not value and allow_empty:
        return ''
    parsed = urlparse(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('HTTP(S) URL girin; API anahtarını URL yerine anahtar alanına yazın.')
    return value.rstrip('/')


def endpoint(base, suffix='chat/completions'):
    return base.rstrip('/') + ('/' if base.rstrip('/').endswith('/v1') else '/v1/') + suffix


def guard_headers(headers):
    raw = headers.get('x-vllm-empty-guard-attempts')
    attempts = int(raw) if raw and re.fullmatch(r'[0-9]{1,6}', raw.strip()) and int(raw) >= 1 else None
    return {'result': headers.get('x-vllm-empty-guard', '').strip().lower() or None,
            'attempts': attempts, 'version': headers.get('x-vllm-empty-guard-version'),
            'policy': headers.get('x-vllm-empty-guard-policy')}


def parse_prometheus(text, model=None):
    counters = {}
    for line in text.splitlines():
        match = re.match(r'^([a-zA-Z_:][\w:]*)(?:\{(.*?)\})?\s+([\d.eE+\-]+)(?:\s+\d+)?$', line)
        if not match:
            continue
        name, labels, value = match.groups()
        if labels and model:
            label = re.search(r'(?:^|,)\s*model_name="([^"]+)"', labels)
            if label and label.group(1) != model:
                continue
        if 'spec_decode' in name:
            value = float(value)
            if math.isfinite(value):
                counters[name] = counters.get(name, 0) + value
    return counters


def speculative_delta(before, after):
    def delta(suffix):
        keys = [k for k in after if k.endswith(suffix)]
        if not keys or any(k not in before or after[k] < before[k] for k in keys):
            return None
        return sum(after[k] - before[k] for k in keys)
    drafts = delta('spec_decode_num_drafts_total')
    tokens = delta('spec_decode_num_draft_tokens_total')
    accepted = delta('spec_decode_num_accepted_tokens_total')
    return {
        'drafted_per_step': tokens / drafts if drafts and tokens is not None else None,
        'acceptance_pct': 100 * accepted / tokens if tokens and accepted is not None else None,
        'drafts': drafts, 'draft_tokens': tokens, 'accepted_tokens': accepted,
    }


def summarize(rows, wall, speculative=None):
    success = [r for r in rows if r['status'] == 'completed']
    counts_known = bool(success) and all(r.get('output_tokens') is not None for r in success)
    total = sum(r['output_tokens'] for r in success) if counts_known else None
    summary = {
        'completed': len(success), 'failed': sum(r['status'] == 'failed' for r in rows),
        'cancelled': sum(r['status'] == 'cancelled' for r in rows), 'total': len(rows),
        'wall_s': wall, 'output_tokens': total,
        'input_tokens': sum(r['input_tokens'] for r in success) if success and all(r.get('input_tokens') is not None for r in success) else None,
        'throughput': total / wall if total is not None and wall > 0 else None,
        'requests_per_s': len(success) / wall if wall > 0 else None,
        'ttft_avg_s': average([r.get('ttft_s') for r in success]),
        'ttft_p95_s': percentile([r.get('ttft_s') for r in success], .95),
        'ttft_p99_s': percentile([r.get('ttft_s') for r in success], .99),
        'stream_avg_tps': average([r.get('stream_tps') for r in success]),
        'e2e_avg_s': average([r.get('e2e_s') for r in success]),
        'e2e_p95_s': percentile([r.get('e2e_s') for r in success], .95),
        'tpot_avg_s': average([r.get('tpot_s') for r in success]),
        'chunk_gap_p95_s': percentile([r.get('chunk_gap_p95_s') for r in success], .95),
        'drafted_per_step': None, 'acceptance_pct': None,
    }
    summary.update(speculative or {})
    return summary


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.db = self.directory / 'lab.sqlite3'
        keyfile = self.directory / 'credential.key'
        if not keyfile.exists():
            fd = os.open(keyfile, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(Fernet.generate_key())
        self.cipher = Fernet(keyfile.read_bytes())
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS inputs (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS duration_runs (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            if not db.execute('SELECT id FROM models LIMIT 1').fetchone():
                for i, (name, provider, model) in enumerate([
                    ('vLLM', 'vLLM · Baseline', 'Qwen/Qwen3.5-122B-A10B-FP8'),
                    ('CBOT Inference', 'CBOT · Speculative', 'Qwen/Qwen3.5-122B-A10B-FP8'),
                    ('vLLM + MTP', 'vLLM · MTP', 'Qwen/Qwen3.8-27B'),
                    ('vLLM + DSpark', 'vLLM · DSpark', 'Qwen/Qwen3.8-27B'),
                ]):
                    self.put('models', {'id': f'demo-{i}', 'name': name, 'provider': provider, 'model': model,
                                        'base_url': '', 'api_key': '', 'metrics_url': '', 'color': COLORS[i], 'demo': True}, db)
            if not db.execute('SELECT id FROM contexts LIMIT 1').fetchone():
                seeds = [
                    ('insurance', 'Hasar dosyası analizi', 'Sigorta', 'Aşağıdaki örnek hasar dosyalarını değerlendir. Kural: Hırsızlık ve fırtına kapsam içindedir; aşınma kapsam dışıdır. Belgeler eksikse ödeme hesaplama ve belge bekleniyor yaz. Net ödeme = min(hasar - muafiyet, limit) - önceki ödeme; negatifse sıfır.\nTR-0034: hırsızlık, belgeler tam, hasar 150000 TL, muafiyet 10000 TL, limit 120000 TL, önceki ödeme 10000 TL.\nTR-0172: fırtına, eksper raporu eksik, hasar 80000 TL.\nTR-0311: aşınma, belgeler tam.\nKararları ve net ödemeyi tabloyla ver. Her dosya için uygulanan kuralı bir cümleyle açıkla. Türkçe yanıtla.'),
                    ('reasoning', 'Mantıksal akıl yürütme', 'Muhakeme', 'Bir ekipte Ayşe, Bora ve Can çalışıyor. Ayşe pazartesi ve çarşamba, Bora salı ve çarşamba, Can pazartesi ve salı uygun. Her gün en az iki kişi çalışacak. Üç günün görev dağılımını tabloyla ver ve herkesin eşit sayıda görev alıp almadığını açıkla.'),
                    ('summary', 'Uzun metin özetleme', 'Özetleme', 'Aşağıdaki örnek faaliyet notunu özetle: Müşteri hizmetleri ekibi bu çeyrekte çağrı yanıtlama süresini iyileştirmeye odaklandı. Yeni iş akışı ile talepler önce önem derecesine göre sınıflandırıldı. Karmaşık dosyalar uzman ekibe aktarıldı. Başarı yalnızca hızla değil doğruluk ve müşteri memnuniyetiyle değerlendirilecek.\nÜç maddelik yönetici özeti ve iki aksiyon önerisi ver.'),
                ]
                for ident, name, category, content in seeds:
                    self.put('contexts', {'id': ident, 'name': name, 'category': category, 'content': content}, db)
        os.chmod(self.db, 0o600)
        # A process restart cannot resume provider streams. Retain partial reports honestly.
        for report in self.list('duration_runs'):
            if report['status'] in ('running', 'stopping', 'queued'):
                report['status'] = 'interrupted'
                report['finished_at'] = now()
                for row in report['requests']:
                    if row['status'] in ('running', 'queued'):
                        row['status'] = 'cancelled'
                report['summary'] = duration.summary(report)
                self.put('duration_runs', report)
        for report in self.list('reports'):
            if report['status'] in ('running', 'stopping', 'queued'):
                report['status'] = 'interrupted'
                report['finished_at'] = now()
                for phase in report['phases']:
                    for target in phase['models']:
                        for row in target['requests']:
                            if row['status'] in ('running', 'queued'):
                                row['status'] = 'cancelled'
                self.put('reports', report)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.db, timeout=30)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def put(self, table, item, db=None):
        assert table in ('models', 'contexts', 'inputs', 'reports', 'duration_runs')
        body = json.dumps(item, ensure_ascii=False, allow_nan=False)
        if db is not None:
            db.execute(f'INSERT OR REPLACE INTO {table} VALUES (?, ?)', (item['id'], body))
        else:
            with self.connect() as connection:
                connection.execute(f'INSERT OR REPLACE INTO {table} VALUES (?, ?)', (item['id'], body))
        return item

    def list(self, table):
        assert table in ('models', 'contexts', 'inputs', 'reports', 'duration_runs')
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute(f'SELECT body FROM {table} ORDER BY rowid')]

    def get(self, table, ident):
        assert table in ('models', 'contexts', 'inputs', 'reports', 'duration_runs')
        with self.connect() as db:
            row = db.execute(f'SELECT body FROM {table} WHERE id = ?', (ident,)).fetchone()
        return json.loads(row[0]) if row else None

    def delete(self, table, ident):
        assert table in ('models', 'contexts', 'inputs')
        with self.connect() as db:
            db.execute(f'DELETE FROM {table} WHERE id = ?', (ident,))

    def list_inputs(self):
        # Long context bodies stay off the library listing and initial benchmark load.
        with self.connect() as db:
            summaries = []
            for row in db.execute('SELECT body FROM inputs ORDER BY rowid DESC'):
                item = json.loads(row[0])
                summary = {k: item[k] for k in ('id', 'name', 'category', 'target_tokens', 'characters', 'estimated_tokens', 'created_at', 'updated_at')}
                summary['preview'] = (item['question'] or item['context'])[:180]
                summaries.append(summary)
        return summaries

    def save_input(self, data):
        for field in ('name', 'category', 'context', 'question'):
            if not isinstance(data.get(field, ''), str):
                raise ValueError('Girdi adı, kategori, bağlam ve soru metin olmalıdır.')
        name = data.get('name', '').strip()
        context, question = data.get('context', ''), data.get('question', '')
        if not name or len(name) > 120:
            raise ValueError('1–120 karakter uzunluğunda bir girdi adı yazın.')
        if len(data.get('category', '')) > 80:
            raise ValueError('Kategori en fazla 80 karakter olabilir.')
        if not context.strip() and not question.strip():
            raise ValueError('Bağlam veya soru alanlarından en az birini doldurun.')
        target = data.get('target_tokens', 0)
        if type(target) is not int or target not in (0, 8192, 16384, 32768, 65536, 131072):
            raise ValueError('Desteklenen hedefler: serbest, 8K, 16K, 32K, 64K, 128K.')
        content = context + '\n\nSoru:\n' + question if context.strip() and question.strip() else context if context.strip() else question
        if len(content) > 1_000_000:
            raise ValueError('Birleştirilmiş girdi en fazla 1 milyon karakter olabilir.')
        ident = data.get('id')
        if ident is not None and (not isinstance(ident, str) or not re.fullmatch(r'[a-f0-9]{12}', ident)):
            raise ValueError('Geçersiz girdi kimliği.')
        old = self.get('inputs', ident) if ident else None
        if ident and not old:
            raise ValueError('Düzenlenecek kayıt bulunamadı; yeni girdi olarak kaydedin.')
        item = {'id': ident or secrets.token_hex(6), 'name': name, 'category': data.get('category', '').strip(),
                'context': context, 'question': question, 'content': content, 'target_tokens': target,
                'characters': len(content), 'estimated_tokens': math.ceil(len(content) / 3),
                'created_at': old['created_at'] if old else now(), 'updated_at': now()}
        return self.put('inputs', item)

    def public_models(self):
        return [{k: v for k, v in m.items() if k != 'api_key'} | {'has_key': bool(m['api_key'])} for m in self.list('models')]

    def save_model(self, data):
        old = self.get('models', data.get('id')) or {}
        if not str(data.get('name', '')).strip() or not str(data.get('model', '')).strip():
            raise ValueError('Görünen ad ve model kimliği zorunludur.')
        key = self.cipher.encrypt(data['api_key'].encode()).decode() if data.get('api_key') else old.get('api_key', '')
        if data.get('clear_key'):
            key = ''
        item = { 'id': old.get('id', secrets.token_hex(6)), 'name': data['name'].strip()[:100],
                 'provider': str(data.get('provider', 'OpenAI uyumlu'))[:100], 'model': data['model'].strip()[:300],
                 'base_url': valid_url(data.get('base_url', '')), 'metrics_url': valid_url(data.get('metrics_url', ''), True),
                 'api_key': key, 'demo': False, 'color': old.get('color', COLORS[len(self.list('models')) % 4]) }
        self.put('models', item)
        return next(m for m in self.public_models() if m['id'] == item['id'])


class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()
        self.runs = {}
        self.events = {}
        self.responses = {}
        self.sessions = {}

    def snapshot(self, ident):
        with self.lock:
            report = self.runs.get(ident) or self.store.get('reports', ident) or self.store.get('duration_runs', ident)
            return copy.deepcopy(report)

    def persist(self, run):
        with self.lock:
            self.store.put('duration_runs' if run.get('kind') == 'duration' else 'reports', run)

    def start(self, data):
        prompts = data.get('prompts', [])
        ids = data.get('model_ids', [])
        mode = data.get('mode', 'concurrent')
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 8 or any(not isinstance(p, str) or not p.strip() or len(p) > 1_000_000 for p in prompts):
            raise ValueError('1–8 adet dolu girdi gerekir; her girdi en fazla 1 milyon karakter olabilir.')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 4 or len(set(ids)) != len(ids):
            raise ValueError('1–4 farklı model seçin.')
        if mode not in ('single', 'concurrent', 'compare') or (mode == 'single' and len(prompts) != 1):
            raise ValueError('Geçerli bir test modu seçin; tek istek modu bir girdi gerektirir.')
        max_tokens = data.get('max_tokens', 512)
        temperature = data.get('temperature', 0)
        timeout = data.get('timeout', 120)
        if type(max_tokens) is not int or not 1 <= max_tokens <= 32768:
            raise ValueError('Çıktı limiti 1–32768 arasında olmalıdır.')
        if type(temperature) not in (float, int) or not math.isfinite(temperature) or not 0 <= temperature <= 2:
            raise ValueError('Temperature 0–2 arasında olmalıdır.')
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 1 <= timeout <= 600:
            raise ValueError('Zaman aşımı 1–600 saniye arasında olmalıdır.')
        if data.get('model_schedule', 'sequential') not in ('sequential', 'parallel'):
            raise ValueError('Geçerli model çalışma düzeni seçin.')
        if type(data.get('stream', True)) is not bool:
            raise ValueError('Yanıt biçimi stream veya normal olmalıdır.')
        models = [self.store.get('models', ident) for ident in ids]
        if any(m is None for m in models):
            raise ValueError('Seçilen model bulunamadı. Ayarlardan model ekleyin.')
        demo = bool(data.get('demo', True))
        if not demo and any(m['demo'] or not m['base_url'] for m in models):
            raise ValueError('Gerçek ölçüm için sağlayıcı URL’si olan modeller seçin veya ayarlardan ekleyin.')
        with self.lock:
            if any(r['status'] in ('running', 'stopping', 'queued') for r in self.runs.values()):
                raise ValueError('Bir test zaten çalışıyor. Önce tamamlanmasını bekleyin veya durdurun.')
            ident = secrets.token_hex(8)
            clean_models = [{k: m[k] for k in ('id', 'name', 'model', 'provider', 'color', 'base_url', 'metrics_url')} for m in models]
            config = {'mode': mode, 'prompts': prompts, 'max_tokens': max_tokens, 'temperature': temperature,
                      'timeout': timeout, 'model_schedule': data.get('model_schedule', 'sequential'), 'demo': demo, 'stream': data.get('stream', True)}
            run = {'id': ident, 'name': str(data.get('name', '')).strip()[:120] or f'{"Demo" if demo else "Benchmark"} · {len(prompts)} istek',
                   'created_at': now(), 'finished_at': None, 'status': 'running', 'config': config, 'models': clean_models,
                   'fingerprint': hashlib.sha256(json.dumps({'config': config, 'models': clean_models}, sort_keys=True).encode()).hexdigest(),
                   'warnings': ['Demo: sentetik veri; performans sonucu olarak kullanmayın.'] if demo else [], 'phases': []}
            for phase in (['serial', 'concurrent'] if mode == 'compare' else ['serial' if mode == 'single' else 'concurrent']):
                run['phases'].append({'name': phase, 'models': [dict(m, status='queued', summary=None, history=[],
                    requests=[{'index': i, 'status': 'queued', 'text': '', 'input_tokens': None, 'output_tokens': None,
                               'ttft_s': None, 'e2e_s': None, 'stream_tps': None, 'tpot_s': None, 'chunk_gap_p95_s': None,
                               'content_chunks': 0, 'error': None} for i in range(len(prompts))]) for m in clean_models]})
            self.runs[ident] = run
            self.events[ident] = threading.Event()
            self.persist(run)
        threading.Thread(target=self.execute, args=(run, models), daemon=True).start()
        return self.snapshot(ident)

    def stop(self, ident):
        with self.lock:
            run = self.runs.get(ident)
            if not run or run['status'] not in ('running', 'stopping'):
                raise ValueError('Çalışan test bulunamadı.')
            run['status'] = 'stopping'
            self.events[ident].set()
            active = list(self.responses.get(ident, []))
        # Shut down sockets before closing buffered HTTPResponse objects (close may block on readline).
        for response in active:
            try:
                import socket
                response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
            except (OSError, AttributeError):
                pass
        return self.snapshot(ident)

    def metrics(self, model):
        if not model.get('metrics_url'):
            return {}, 'Draft/kabul metrikleri için metrics URL yapılandırılmadı.'
        try:
            headers = {}
            if model['api_key']:
                headers['Authorization'] = 'Bearer ' + self.store.cipher.decrypt(model['api_key'].encode()).decode()
            opener = build_opener(ProxyHandler({}))
            with opener.open(Request(model['metrics_url'], headers=headers), timeout=5) as response:
                values = parse_prometheus(response.read(4_000_000).decode(), model['model'])
            return values, None if values else 'Metrics yanıtında desteklenen speculative sayaçları bulunamadı.'
        except Exception:
            return {}, 'Metrics uç noktasına erişilemedi; draft ve kabul oranı ölçülemedi.'

    def execute(self, run, models):
        cancel = self.events[run['id']]
        try:
            for phase in run['phases']:
                if cancel.is_set():
                    break
                if run['config']['model_schedule'] == 'parallel':
                    with concurrent.futures.ThreadPoolExecutor(max_workers=len(models)) as pool:
                        list(pool.map(lambda pair: self.measure_model(run, phase, *pair), zip(phase['models'], models)))
                else:
                    for target, model in zip(phase['models'], models):
                        if cancel.is_set():
                            break
                        self.measure_model(run, phase, target, model)
            with self.lock:
                for phase in run['phases']:
                    for target in phase['models']:
                        for row in target['requests']:
                            if row['status'] in ('queued', 'running'):
                                row['status'] = 'cancelled'
                        if target['status'] in ('queued', 'running'):
                            target['status'] = 'cancelled'
                failures = sum(r['status'] == 'failed' for p in run['phases'] for m in p['models'] for r in m['requests'])
                run['status'] = 'cancelled' if cancel.is_set() else ('partial' if failures else 'completed')
        except Exception:
            with self.lock:
                run['status'] = 'failed'
                run['warnings'].append('Test yürütücüsü hata verdi; kısmi sonuçlar korundu.')
        finally:
            with self.lock:
                run['finished_at'] = now()
                self.persist(run)

    def measure_model(self, run, phase, target, model):
        cancel = self.events[run['id']]
        before, warning = ({}, None) if run['config']['demo'] else self.metrics(model)
        with self.lock:
            target['status'] = 'running'
            if warning:
                run['warnings'].append(model['name'] + ': ' + warning)
        started = time.perf_counter()
        done = threading.Event()
        sampler = threading.Thread(target=self.sample, args=(target, started, done), daemon=True)
        sampler.start()
        workers = len(target['requests']) if phase['name'] == 'concurrent' else 1
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(lambda row: self.request_one(run, target, model, row), target['requests']))
        wall = time.perf_counter() - started
        done.set()
        sampler.join(timeout=1)
        after, after_warning = ({}, None) if run['config']['demo'] or cancel.is_set() else self.metrics(model)
        spec = speculative_delta(before, after)
        if not run['config']['demo'] and model.get('metrics_url'):
            with self.lock:
                run['warnings'].append(model['name'] + ': Draft/kabul sayaçları sunucu kapsamındadır; diğer trafik ve metrik yayın gecikmesi farkı etkileyebilir.')
                if after_warning:
                    run['warnings'].append(model['name'] + ': ' + after_warning)
        with self.lock:
            target['summary'] = summarize(target['requests'], wall, spec)
            target['history'].append(self.sample_point(target, wall))
            target['status'] = 'cancelled' if cancel.is_set() else ('partial' if any(r['status'] == 'failed' for r in target['requests']) else 'completed')
            self.persist(run)

    def sample_point(self, target, elapsed):
        known = [r for r in target['requests'] if r.get('output_tokens') is not None]
        total = sum(r['output_tokens'] for r in known)
        # Unknown provider usage is never inferred from SSE chunk count.
        return {'time_s': elapsed, 'tokens': total if known else None, 'throughput': total / elapsed if known and elapsed else None}

    def sample(self, target, started, done):
        while not done.wait(.25):
            with self.lock:
                target['history'].append(self.sample_point(target, time.perf_counter() - started))

    def request_one(self, run, target, model, row):
        cancel = self.events[run['id']]
        if cancel.is_set():
            with self.lock:
                row['status'] = 'cancelled'
            return
        prompt_index = row.get('prompt_index', row['index'])
        started = time.perf_counter()
        times, usage, finish, done, response = [], None, None, False, None
        with self.lock:
            row['status'] = 'running'
        try:
            if run['config']['demo']:
                rank = next(i for i, m in enumerate(run['models']) if m['id'] == model['id'])
                if cancel.wait(.25 + rank * .08 + prompt_index * .05):
                    raise Cancelled()
                prompt = run['config']['prompts'][prompt_index]
                answer = ('Örnek yanıt — demo modu.\n\nTR-0034: Kapsam içi, belgeler tam. Net ödeme: 110.000 TL.\nTR-0172: Eksper raporu eksik; belge bekleniyor.\nTR-0311: Aşınma kapsam dışı; ret.\n\nBu çıktı arayüzü denemek için üretildi; gerçek model yanıtı değildir.' if 'TR-0034' in prompt else 'Örnek yanıt — demo modu.\n\nGirdi alındı ve örnek bir yanıt hazırlandı. Gerçek model çıktısını görmek için yönetici ayarlarından sağlayıcınızı ekleyip gerçek API modunda çalıştırın.\n\nBu metin ve ölçümler sentetiktir.')
                chunks = [answer[i:i+15] for i in range(0, len(answer), 15)]
                for i, chunk in enumerate(chunks):
                    if cancel.wait(.09 / (1 + rank * .2)):
                        raise Cancelled()
                    times.append(time.perf_counter())
                    with self.lock:
                        if run['config'].get('stream', True):
                            row['text'] += chunk
                        row['output_tokens'] = min(run['config']['max_tokens'], (i + 1) * 7)
                        if run['config'].get('stream', True):
                            row['ttft_s'] = times[0] - started
                usage = {'prompt_tokens': max(1, len(prompt) // 3), 'completion_tokens': row['output_tokens']}
                if not run['config'].get('stream', True):
                    with self.lock:
                        row['text'] = answer
                    times = []
                with self.lock:
                    row['http_status'] = 200
                    row['guard'] = {'result': 'pass', 'attempts': 1, 'version': 'demo', 'policy': 'synthetic'}
                finish, done = 'stop', True
            else:
                config = run['config']
                payload = {'model': model['model'], 'messages': [{'role': 'user', 'content': config['prompts'][prompt_index]}],
                           'max_tokens': config['max_tokens'], 'temperature': config.get('temperature', 0), 'stream': config.get('stream', True)}
                if config.get('request_payload'):
                    payload = copy.deepcopy(config['request_payload'])
                if payload['stream']:
                    payload['stream_options'] = dict(payload.get('stream_options', {}), include_usage=True)
                headers = {'Content-Type': 'application/json', 'Accept': 'text/event-stream' if payload['stream'] else 'application/json'}
                if model['api_key']:
                    headers['Authorization'] = 'Bearer ' + self.store.cipher.decrypt(model['api_key'].encode()).decode()
                opener = build_opener(ProxyHandler({}))
                response = opener.open(Request(endpoint(model['base_url']), data=json.dumps(payload).encode(), headers=headers), timeout=config['timeout'])
                with self.lock:
                    row['http_status'] = response.status
                    row['guard'] = guard_headers(response.headers)
                    self.responses.setdefault(run['id'], []).append(response)
                # Absolute deadline also interrupts stalled streams, not just continuously arriving chunks.
                remaining = config['timeout'] - (time.perf_counter() - started)
                timer = threading.Timer(max(.001, remaining), self.shutdown_response, args=(response,))
                timer.daemon = True
                timer.start()
                try:
                    if cancel.is_set():
                        raise Cancelled()
                    if not payload['stream'] or 'application/json' in response.headers.get('Content-Type', ''):
                        obj = json.loads(response.read())
                        if cancel.is_set():
                            raise Cancelled()
                        if time.perf_counter() - started > config['timeout']:
                            raise TimeoutError()
                        if obj.get('error'):
                            raise ValueError('Sağlayıcı yanıt hatası bildirdi.')
                        choices = obj.get('choices') or []
                        if not choices:
                            raise ValueError('Sağlayıcı yanıtında choices bulunamadı.')
                        choice = choices[0]
                        content = choice.get('message', {}).get('content') or choice.get('text', '')
                        with self.lock:
                            row['reasoning'] = choice.get('message', {}).get('reasoning') or choice.get('message', {}).get('reasoning_content') or ''
                        if not isinstance(content, str) or not content.strip():
                            row['empty_answer'] = True
                            raise ValueError('Sağlayıcı yanıtında metin bulunamadı.')
                        usage = obj.get('usage')
                        finish = choice.get('finish_reason')
                        with self.lock:
                            row['text'] = content
                            row['reasoning'] = choice.get('message', {}).get('reasoning') or choice.get('message', {}).get('reasoning_content') or ''
                            row['response_format'] = 'normal'
                    else:
                        for raw in response:
                            if cancel.is_set():
                                raise Cancelled()
                            if time.perf_counter() - started > config['timeout']:
                                raise TimeoutError()
                            line = raw.decode('utf-8').strip()
                            if not line.startswith('data:'):
                                continue
                            data = line[5:].strip()
                            if data == '[DONE]':
                                done = True
                                break
                            obj = json.loads(data)
                            if obj.get('error'):
                                raise ValueError('Sağlayıcı akış hatası bildirdi.')
                            if obj.get('usage'):
                                usage = obj['usage']
                            for choice in obj.get('choices', []):
                                delta = choice.get('delta', {})
                                content = delta.get('content') or choice.get('text', '')
                                reasoning = delta.get('reasoning_content') or delta.get('reasoning') or ''
                                if content or reasoning:
                                    times.append(time.perf_counter())
                                    with self.lock:
                                        row['text'] += content
                                        row['reasoning'] = row.get('reasoning', '') + reasoning
                                        row['ttft_s'] = times[0] - started
                                        row['content_chunks'] = len(times)
                                if choice.get('finish_reason') is not None:
                                    finish = choice['finish_reason']
                        if run.get('kind') == 'duration' and not row['text'].strip():
                            row['empty_answer'] = True
                            raise ValueError('Boş cevap: reasoning gelse bile kullanıcıya yönelik content alınmadı.')
                        if not done or finish is None or not times:
                            raise ValueError('Eksik SSE akışı: DONE, bitiş nedeni veya içerik yok.')
                finally:
                    timer.cancel()
            ended = time.perf_counter()
            def token_count(name):
                value = usage.get(name) if usage else None
                return value if type(value) is int and value >= 0 else None
            output = token_count('completion_tokens')
            span = times[-1] - times[0] if len(times) > 1 else 0
            with self.lock:
                row.update(status='completed', input_tokens=token_count('prompt_tokens'), output_tokens=output,
                           ttft_s=times[0] - started if times else None, e2e_s=ended - started, finish_reason=finish,
                           stream_tps=(output - 1) / span if output is not None and output > 1 and span > 0 else None,
                           tpot_s=span / (output - 1) if output is not None and output > 1 and span > 0 else None,
                           chunk_gap_p95_s=percentile([b-a for a,b in zip(times, times[1:])], .95),
                           content_chunks=len(times), usage_source='synthetic' if run['config']['demo'] else ('provider' if usage else 'unavailable'))
                if not usage:
                    warning = model['name'] + ': Sağlayıcı usage göndermedi; token tabanlı hızlar hesaplanamadı.'
                    if warning not in run['warnings']:
                        run['warnings'].append(warning)
        except Exception as exc:
            with self.lock:
                if isinstance(exc, HTTPError):
                    row['http_status'] = exc.code
                    row['guard'] = guard_headers(exc.headers)
                    exc.close()
                cancelled = cancel.is_set() or isinstance(exc, Cancelled)
                error = None if cancelled else (str(exc) if isinstance(exc, ValueError) else f'Sağlayıcı isteği başarısız ({type(exc).__name__}). URL, anahtar ve zaman aşımını kontrol edin.')
                row.update(status='cancelled' if cancelled else 'failed', error=error, e2e_s=time.perf_counter()-started)
        finally:
            if response:
                with self.lock:
                    if response in self.responses.get(run['id'], []):
                        self.responses[run['id']].remove(response)
                response.close()

    @staticmethod
    def shutdown_response(response):
        try:
            import socket
            response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
        except (OSError, AttributeError):
            pass


def markdown_report(run):
    lines = [f'# {run["name"]}', '', f'Koşu: {run["id"]} · {run["created_at"]}',
             f'Durum: {run["status"]} · {"SENTETİK DEMO" if run["config"]["demo"] else "Gerçek API"}', '',
             '## Yapılandırma', '', '```json', json.dumps(run['config'], ensure_ascii=False, indent=2), '```', '']
    for phase in run['phases']:
        lines += [f'## {phase["name"]}', '', '| Metrik | ' + ' | '.join(m['name'].replace('|', '\\|') for m in phase['models']) + ' |', '|---|' + '---:|'*len(phase['models'])]
        names = [('completed', 'Başarılı istek'), ('failed', 'Başarısız istek'), ('cancelled', 'Durdurulan istek'),
                 ('throughput', 'Toplam verim tok/sn'), ('ttft_avg_s', 'Ort. TTFT sn'), ('ttft_p95_s', 'p95 TTFT sn'),
                 ('ttft_p99_s', 'p99 TTFT sn'), ('stream_avg_tps', 'Ort. akış hızı tok/sn (tahmini)'),
                 ('e2e_avg_s', 'Ort. E2E sn'), ('e2e_p95_s', 'p95 E2E sn'), ('wall_s', 'Duvar sn'),
                 ('input_tokens', 'Giriş token'), ('output_tokens', 'Çıktı token'), ('tpot_avg_s', 'Ort. TPOT sn (tahmini)'),
                 ('chunk_gap_p95_s', 'p95 parça aralığı sn'), ('requests_per_s', 'İstek/sn'),
                 ('drafted_per_step', 'Drafted/adım'), ('acceptance_pct', 'Kabul %')]
        for key, label in names:
            values = [(m['summary'] or {}).get(key) for m in phase['models']]
            lines.append('| ' + label + ' | ' + ' | '.join('—' if v is None else f'{v:.4f}' for v in values) + ' |')
        for model in phase['models']:
            for row in model['requests']:
                stats = {k:row.get(k) for k in ('input_tokens', 'output_tokens', 'ttft_s', 'e2e_s', 'stream_tps', 'tpot_s', 'finish_reason', 'usage_source')}
                lines += ['', f'### {model["name"]} · Girdi {row["index"]+1} · {row["status"]}', '', '```json', json.dumps(stats,ensure_ascii=False,indent=2), '```', '', row.get('error') or row['text']]
        lines.append('')
    lines += ['## Ölçüm yöntemi', '', 'Verim = başarılı çıktı tokenları / model fazının duvar süresi. TTFT ilk içerik veya reasoning parçasına kadardır. Akış hızı ve TPOT, sağlayıcı token sayısı ile içerik parçalarının zaman aralığından türetilen tahminlerdir; SSE parçaları token sayılmaz. Eksik usage değerleri boş bırakılır. p95 doğrusal interpolasyonla hesaplanır; 1–8 örnek istatistiksel genelleme sağlamaz.', '', '## Notlar', ''] + ['- ' + w for w in dict.fromkeys(run['warnings'])]
    return '\n'.join(lines)


def csv_report(run):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['run_id', 'demo', 'phase', 'model', 'request', 'status', 'input_tokens', 'output_tokens', 'ttft_s', 'e2e_s', 'stream_tps_estimate', 'tpot_s_estimate', 'error'])
    for phase in run['phases']:
        for model in phase['models']:
            for row in model['requests']:
                fields = [run['id'], run['config']['demo'], phase['name'], model['name'], row['index']+1] + [row.get(k) for k in ('status', 'input_tokens', 'output_tokens', 'ttft_s', 'e2e_s', 'stream_tps', 'tpot_s', 'error')]
                # Keep spreadsheet exports from interpreting user/provider strings as formulas.
                writer.writerow(["'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in fields])
    return '\ufeff' + output.getvalue()


def handler_for(engine):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'InferenceLab/0.1'

        def log_message(self, fmt, *args):
            # URLs and credentials are deliberately excluded from logs.
            pass

        def reply(self, data, status=200, headers=None, content_type='application/json; charset=utf-8'):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode() if content_type.startswith('application/json') else data.encode() if isinstance(data, str) else data
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def body(self):
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 10_000_000:
                raise ValueError('Geçerli ve 10 MB altında bir istek gönderin.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('JSON nesnesi gereklidir.')
            return data

        def authenticated(self):
            cookie = SimpleCookie()
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie.get('lab_session')
            with engine.lock:
                expiry = engine.sessions.get(token.value, 0) if token else 0
            return expiry > time.time()

        def safe_origin(self):
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '')
            # Vite's local dev proxy preserves the browser origin. Never accept arbitrary origins.
            return not origin or origin in ('http://' + host, 'https://' + host, 'http://127.0.0.1:5173', 'http://localhost:5173')

        def do_GET(self):
            try:
                path = urlparse(self.path).path
                if path == '/api/health':
                    return self.reply({'status': 'ok'})
                if path == '/api/session':
                    return self.reply({'authenticated': self.authenticated(), 'user': 'admin' if self.authenticated() else None})
                if path.startswith('/api/'):
                    if not self.authenticated():
                        return self.reply({'error': 'Devam etmek için giriş yapın.'}, 401)
                    if path == '/api/models':
                        return self.reply(engine.store.public_models())
                    if path == '/api/contexts':
                        return self.reply(engine.store.list('contexts'))
                    if path == '/api/inputs':
                        return self.reply(engine.store.list_inputs())
                    saved_match = re.fullmatch(r'/api/inputs/([a-f0-9]{12})', path)
                    if saved_match:
                        item = engine.store.get('inputs', saved_match.group(1))
                        return self.reply(item) if item else self.reply({'error': 'Kayıtlı girdi bulunamadı.'}, 404)
                    if path == '/api/duration-runs':
                        runs = sorted(engine.store.list('duration_runs'), key=lambda r: r['created_at'], reverse=True)
                        return self.reply([{k: r[k] for k in ('id', 'name', 'created_at', 'status', 'summary', 'models')} for r in runs])
                    timed = re.fullmatch(r'/api/duration-runs/([a-f0-9]{16})(?:/requests/(\d+))?', path)
                    if timed:
                        if timed.group(2) is not None:
                            run = engine.snapshot(timed.group(1))
                            index = int(timed.group(2))
                            if not run or run.get('kind') != 'duration' or index >= len(run['requests']):
                                return self.reply({'error': 'İstek bulunamadı.'}, 404)
                            return self.reply(run['requests'][index])
                        query = parse_qs(urlparse(self.path).query)
                        offset = max(0, int(query.get('offset', ['0'])[0]))
                        limit = min(100, max(1, int(query.get('limit', ['50'])[0])))
                        run = duration.page(engine, timed.group(1), offset, limit)
                        return self.reply(run) if run else self.reply({'error': 'Test bulunamadı.'}, 404)
                    if path == '/api/reports':
                        reports = sorted(engine.store.list('reports'), key=lambda r: r['created_at'], reverse=True)
                        return self.reply([{k: r[k] for k in ('id', 'name', 'created_at', 'finished_at', 'status', 'config', 'models')} for r in reports])
                    match = re.fullmatch(r'/api/runs/([a-f0-9]{16})(?:/export)?', path)
                    if match:
                        run = engine.snapshot(match.group(1))
                        if not run:
                            return self.reply({'error': 'Rapor bulunamadı.'}, 404)
                        if path.endswith('/export'):
                            fmt = parse_qs(urlparse(self.path).query).get('format', ['json'])[0]
                            if fmt not in ('json', 'md', 'csv'):
                                raise ValueError('Desteklenen biçimler: json, md, csv.')
                            headers = {'Content-Disposition': f'attachment; filename="inference-{run["id"]}.{fmt}"'}
                            if fmt == 'json':
                                return self.reply(run, headers=headers)
                            return self.reply(markdown_report(run) if fmt == 'md' else csv_report(run), headers=headers,
                                              content_type='text/markdown; charset=utf-8' if fmt == 'md' else 'text/csv; charset=utf-8')
                        return self.reply(run)
                    return self.reply({'error': 'Uç nokta bulunamadı.'}, 404)
                root = (ROOT / 'dist').resolve()
                candidate = (root / path.lstrip('/')).resolve()
                if not candidate.is_relative_to(root):
                    return self.reply({'error': 'Geçersiz yol.'}, 403)
                if not candidate.is_file():
                    candidate = root / 'index.html'
                if not candidate.is_file():
                    return self.reply('Arayüz için npm run build çalıştırın veya http://127.0.0.1:5173 adresini açın.', content_type='text/plain; charset=utf-8')
                return self.reply(candidate.read_bytes(), content_type=mimetypes.guess_type(candidate)[0] or 'application/octet-stream')
            except (ValueError, json.JSONDecodeError) as exc:
                self.reply({'error': str(exc)}, 400)

        def do_POST(self):
            try:
                if not self.safe_origin():
                    return self.reply({'error': 'Bu kaynaktan istek kabul edilmiyor.'}, 403)
                path = urlparse(self.path).path
                data = self.body()
                if path == '/api/login':
                    username = os.environ.get('LAB_ADMIN_USER', 'admin')
                    password = os.environ.get('LAB_ADMIN_PASSWORD', 'admin')
                    if not hmac.compare_digest(str(data.get('username', '')).encode(), username.encode()) or not hmac.compare_digest(str(data.get('password', '')).encode(), password.encode()):
                        return self.reply({'error': 'Kullanıcı adı veya şifre hatalı.'}, 401)
                    token = secrets.token_urlsafe(32)
                    with engine.lock:
                        engine.sessions = {k:v for k,v in engine.sessions.items() if v > time.time()}
                        engine.sessions[token] = time.time() + 8 * 3600
                    return self.reply({'authenticated': True}, headers={'Set-Cookie': f'lab_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'})
                if not self.authenticated():
                    return self.reply({'error': 'Devam etmek için giriş yapın.'}, 401)
                if path == '/api/logout':
                    cookie = SimpleCookie(self.headers.get('Cookie', ''))
                    if cookie.get('lab_session'):
                        with engine.lock:
                            engine.sessions.pop(cookie['lab_session'].value, None)
                    return self.reply({'ok': True}, headers={'Set-Cookie': 'lab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
                if path == '/api/models':
                    return self.reply(engine.store.save_model(data))
                if path == '/api/inputs':
                    return self.reply(engine.store.save_input(data))
                if path == '/api/contexts':
                    if not str(data.get('name', '')).strip() or not str(data.get('content', '')).strip():
                        raise ValueError('Bağlam adı ve içeriği zorunludur.')
                    if len(data['content']) > 1_000_000:
                        raise ValueError('Bağlam en fazla 1 milyon karakter olabilir.')
                    item = {k: str(data.get(k, '')) for k in ('name', 'category', 'content')}
                    item['id'] = data.get('id') or secrets.token_hex(6)
                    return self.reply(engine.store.put('contexts', item))
                if path == '/api/request-input':
                    return self.reply(parse_input(data.get('text', '')))
                if path == '/api/duration-runs':
                    return self.reply(duration.start(engine, data), 201)
                if path == '/api/runs':
                    return self.reply(engine.start(data), 201)
                match = re.fullmatch(r'/api/(?:runs|duration-runs)/([a-f0-9]{16})/stop', path)
                if match:
                    return self.reply(engine.stop(match.group(1)))
                return self.reply({'error': 'Uç nokta bulunamadı.'}, 404)
            except (ValueError, json.JSONDecodeError) as exc:
                self.reply({'error': str(exc)}, 400)
            except Exception:
                self.reply({'error': 'İşlem tamamlanamadı. Sunucu ayarlarını kontrol edin.'}, 500)

        def do_DELETE(self):
            if not self.safe_origin():
                return self.reply({'error': 'Bu kaynaktan istek kabul edilmiyor.'}, 403)
            if not self.authenticated():
                return self.reply({'error': 'Devam etmek için giriş yapın.'}, 401)
            match = re.fullmatch(r'/api/(models|contexts|inputs)/([\w-]+)', urlparse(self.path).path)
            if not match:
                return self.reply({'error': 'Uç nokta bulunamadı.'}, 404)
            engine.store.delete(match.group(1), match.group(2))
            self.reply({'ok': True})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--host', default='127.0.0.1', help='Local default; containers use 0.0.0.0')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    engine = Engine(Store(args.data_dir))
    server = ThreadingHTTPServer((args.host, args.port), handler_for(engine))
    print(f'Inference Lab backend: http://{args.host}:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == '__main__':
    main()

"""Independent paced request lanes with bounded concurrency and persisted results."""
import concurrent.futures
import copy
import math
import secrets
import threading
import time
from datetime import datetime, timezone
from request_input import validate_payload


def stamp():
    return datetime.now(timezone.utc).isoformat()


def summary(run):
    rows = run['requests']
    terminal = [r for r in rows if r['status'] in ('completed', 'failed', 'cancelled')]
    guards = [r.get('guard', {}) for r in terminal]
    success = sum(r['status'] == 'completed' for r in rows)
    return {'total': len(rows), 'completed': success,
            'failed': sum(r['status'] == 'failed' for r in rows),
            'cancelled': sum(r['status'] == 'cancelled' for r in rows),
            'active': sum(r['status'] == 'running' for r in rows),
            'guard_pass': sum(g.get('result') == 'pass' for g in guards),
            'guard_other': sum(g.get('result') is not None and g.get('result') != 'pass' for g in guards),
            'guard_missing': sum(g.get('result') is None for g in guards),
            'retried': sum(g.get('attempts') is not None and g['attempts'] > 1 for g in guards),
            'attempts_unknown': sum(g.get('attempts') is None for g in guards),
            'empty': sum(r.get('empty_answer', False) for r in rows),
            'all_success': bool(rows) and success == len(rows) and run['status'] == 'completed',
            'all_guard_pass': bool(terminal) and len(terminal) == len(rows) and all(g.get('result') == 'pass' for g in guards)}


def start(engine, data):
    model = engine.store.get('models', data.get('model_id', ''))
    if not model:
        raise ValueError('Tek bir kayıtlı model seçin.')
    lanes = data.get('concurrency', 1)
    duration = data.get('duration_s', 60)
    interval = data.get('interval_s', 1)
    timeout = data.get('timeout', 150)
    if type(lanes) is not int or not 1 <= lanes <= 8:
        raise ValueError('Eşzamanlılık 1–8 arasında olmalıdır.')
    for value, low, high, label in ((duration, 1, 3600, 'Test süresi'), (interval, .1, 600, 'Bekleme'), (timeout, 1, 600, 'Zaman aşımı')):
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{label} {low}–{high} saniye arasında olmalıdır.')
    payload = copy.deepcopy(data.get('payload'))
    validate_payload(payload)
    if payload.get('model') and payload['model'] != model['model']:
        raise ValueError('JSON model kimliği seçilen kayıtlı modelle eşleşmiyor.')
    payload['model'] = model['model']
    payload.setdefault('stream', True)
    if payload['stream']:
        payload['stream_options'] = dict(payload.get('stream_options', {}), include_usage=True)
    else:
        payload.pop('stream_options', None)
    demo = data.get('demo', False)
    if type(demo) is not bool:
        raise ValueError('demo true veya false olmalıdır.')
    if not demo and (model['demo'] or not model['base_url']):
        raise ValueError('Gerçek test için sağlayıcı URL’si olan bir model seçin.')
    clean = {k: model[k] for k in ('id', 'name', 'model', 'provider', 'color', 'base_url', 'metrics_url')}
    config = {'concurrency': lanes, 'duration_s': duration, 'interval_s': interval, 'timeout': timeout,
              'request_payload': payload, 'prompts': ['\n'.join(m['content'] for m in payload['messages'])],
              'max_tokens': payload.get('max_tokens', payload.get('max_completion_tokens', 1024)),
              'stream': payload['stream'], 'demo': demo}
    with engine.lock:
        if any(r['status'] in ('running', 'stopping', 'queued') for r in engine.runs.values()):
            raise ValueError('Başka bir test çalışıyor; önce tamamlanmasını bekleyin veya durdurun.')
        ident = secrets.token_hex(8)
        run = {'id': ident, 'kind': 'duration', 'name': str(data.get('name', '')).strip()[:120] or f'Süreli test · {model["name"]}',
               'created_at': stamp(), 'finished_at': None, 'status': 'running', 'config': config, 'models': [clean],
               'requests': [], 'warnings': ['Demo: yanıtlar ve guard başlıkları sentetiktir.'] if demo else [], 'elapsed_s': 0}
        run['summary'] = summary(run)
        engine.runs[ident] = run
        engine.events[ident] = threading.Event()
        engine.persist(run)
    threading.Thread(target=execute, args=(engine, run, model), daemon=True).start()
    return page(engine, ident)


def page(engine, ident, offset=0, limit=50):
    with engine.lock:
        run = engine.runs.get(ident) or engine.store.get('duration_runs', ident)
        if not run or run.get('kind') != 'duration':
            return None
        result = {k: copy.deepcopy(v) for k, v in run.items() if k != 'requests'}
        rows = run['requests']
        result['summary'] = summary(run)
        result['requests'] = [{k: copy.deepcopy(v) for k, v in r.items() if k not in ('text', 'reasoning')} for r in list(reversed(rows))[offset:offset+limit]]
        result['offset'], result['limit'] = offset, limit
        return result


def execute(engine, run, model):
    cancel = engine.events[run['id']]
    started = time.perf_counter()
    deadline = started + run['config']['duration_s']
    done = threading.Event()

    def checkpoint():
        while not done.wait(1):
            with engine.lock:
                run['elapsed_s'] = time.perf_counter() - started
                run['summary'] = summary(run)
                engine.persist(run)

    def lane(number):
        while not cancel.is_set() and time.perf_counter() < deadline:
            with engine.lock:
                if cancel.is_set() or time.perf_counter() >= deadline:
                    break
                if len(run['requests']) >= 10000:
                    if '10.000 istek sınırına ulaşıldı.' not in run['warnings']:
                        run['warnings'].append('10.000 istek sınırına ulaşıldı.')
                    break
                row = {'index': len(run['requests']), 'lane': number, 'prompt_index': 0, 'status': 'running',
                       'started_at': stamp(), 'start_offset_s': time.perf_counter() - started,
                       'text': '', 'reasoning': '', 'input_tokens': None, 'output_tokens': None,
                       'ttft_s': None, 'e2e_s': None, 'stream_tps': None, 'tpot_s': None,
                       'chunk_gap_p95_s': None, 'content_chunks': 0, 'error': None}
                run['requests'].append(row)
            engine.request_one(run, None, model, row)
            with engine.lock:
                row['finished_at'] = stamp()
                row['end_offset_s'] = time.perf_counter() - started
                row['tokens_per_s'] = row['output_tokens'] / row['e2e_s'] if row['status'] == 'completed' and row['output_tokens'] is not None and row['e2e_s'] else None
                run['summary'] = summary(run)
            remaining = deadline - time.perf_counter()
            if remaining <= 0 or cancel.wait(min(run['config']['interval_s'], remaining)):
                break
    checker = threading.Thread(target=checkpoint, daemon=True)
    checker.start()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=run['config']['concurrency']) as pool:
            list(pool.map(lane, range(1, run['config']['concurrency'] + 1)))
        with engine.lock:
            final_status = 'cancelled' if cancel.is_set() else ('partial' if any(r['status'] == 'failed' for r in run['requests']) or len(run['requests']) >= 10000 else 'completed')
    except Exception:
        with engine.lock:
            final_status = 'failed'
            run['warnings'].append('Test yürütücüsü hata verdi; alınan sonuçlar korundu.')
    finally:
        done.set()
        checker.join()
        with engine.lock:
            run['status'] = final_status
            run['elapsed_s'] = time.perf_counter() - started
            run['finished_at'] = stamp()
            run['summary'] = summary(run)
            engine.persist(run)

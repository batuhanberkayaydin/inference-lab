"""Independent paced request lanes with bounded concurrency and persisted results."""
import concurrent.futures
import copy
import math
import secrets
import threading
import time
from datetime import datetime, timezone
from limits import MAX_CONCURRENT_REQUESTS
from media import image_refs, model_input_format
from request_input import validate_payload


def stamp():
    return datetime.now(timezone.utc).isoformat()


def summary(run):
    rows = run['requests']
    success = sum(r['status'] == 'completed' for r in rows)
    result = {'total': len(rows), 'completed': success,
              'failed': sum(r['status'] == 'failed' for r in rows),
              'cancelled': sum(r['status'] == 'cancelled' for r in rows),
              'active': sum(r['status'] == 'running' for r in rows),
              'empty': sum(r.get('empty_answer', False) for r in rows),
              'all_success': bool(rows) and success == len(rows) and run['status'] == 'completed'}
    # Historical runs monitored guard headers before the model option existed.
    if run['config'].get('empty_guard_enabled', True):
        guards = [r.get('guard', {}) for r in rows if r['status'] in ('completed', 'failed', 'cancelled')]
        result.update(
            guard_pass=sum(g.get('result') == 'pass' for g in guards),
            guard_other=sum(g.get('result') is not None and g.get('result') != 'pass' for g in guards),
            guard_missing=sum(g.get('result') is None for g in guards),
            retried=sum(g.get('attempts') is not None and g['attempts'] > 1 for g in guards),
            attempts_unknown=sum(g.get('attempts') is None for g in guards),
            all_guard_pass=bool(guards) and len(guards) == len(rows) and all(g.get('result') == 'pass' for g in guards))
    return result


def start(engine, data):
    model = engine.store.get('models', data.get('model_id', ''))
    if not model:
        raise ValueError('Tek bir kayıtlı model seçin.')
    lanes = data.get('concurrency', 1)
    duration = data.get('duration_s', 60)
    interval = data.get('interval_s', 1)
    timeout = data.get('timeout', 150)
    if type(lanes) is not int or not 1 <= lanes <= MAX_CONCURRENT_REQUESTS:
        raise ValueError(f'Eşzamanlılık 1–{MAX_CONCURRENT_REQUESTS} arasında olmalıdır.')
    for value, low, high, label in ((duration, 1, 3600, 'Test süresi'), (interval, .1, 600, 'Bekleme'), (timeout, 1, 600, 'Zaman aşımı')):
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{label} {low}–{high} saniye arasında olmalıdır.')
    payload = copy.deepcopy(data.get('payload'))
    validate_payload(payload)
    refs = image_refs(data.get('images', []))
    engine.store.media.check(refs)
    messages = payload['messages']
    if refs and (len(messages) != 1 or messages[0]['role'] != 'user' or not isinstance(messages[0]['content'], str)):
        raise ValueError('Eklenen dosyalar tek bir kullanıcı metniyle kullanılabilir.')
    raw_parts = [part for msg in messages if isinstance(msg['content'], list) for part in msg['content']]
    if model_input_format(model) == 'ocr' and len(refs) + sum(part['type'] == 'image_url' for part in raw_parts) != 1:
        raise ValueError('LightOnOCR için tam bir görsel veya bir PDF sayfası ekleyin.')
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
    if demo:
        raise ValueError('Demo modu kaldırıldı. Gerçek API için bir model seçin.')
    if not demo and (model['demo'] or not model['base_url']):
        raise ValueError('Gerçek test için sağlayıcı URL’si olan bir model seçin.')
    clean = {k: model[k] for k in ('id', 'name', 'model', 'provider', 'color', 'base_url', 'metrics_url')}
    texts = [m['content'] if isinstance(m['content'], str) else '\n'.join(
        part['text'] for part in m['content'] if part['type'] == 'text') for m in messages]
    config = {'concurrency': lanes, 'duration_s': duration, 'interval_s': interval, 'timeout': timeout,
              'request_payload': payload, 'prompts': ['\n'.join(texts)],
              'max_tokens': payload.get('max_tokens', payload.get('max_completion_tokens', 1024)),
              'stream': payload['stream'], 'demo': demo,
              'empty_guard_enabled': model.get('empty_guard_enabled', False)}
    if refs:
        config['prompt_images'] = {'0': refs}
    with engine.lock:
        if any(r['status'] in ('running', 'stopping', 'queued') for r in engine.runs.values()):
            raise ValueError('Başka bir test çalışıyor; önce tamamlanmasını bekleyin veya durdurun.')
        model = engine.runtime_model(model, demo)
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
            remaining = deadline - time.perf_counter()
            if remaining <= 0 or cancel.wait(min(run['config']['interval_s'], remaining)):
                break
    checker = threading.Thread(target=checkpoint, daemon=True)
    monitor = None
    try:
        monitor = engine.start_response_monitor(run['id'], done)
        checker.start()
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
        if checker.ident is not None:
            checker.join()
        if monitor is not None:
            monitor.join()
        with engine.lock:
            engine.responses.pop(run['id'], None)
            run['status'] = final_status
            run['elapsed_s'] = time.perf_counter() - started
            run['finished_at'] = stamp()
            run['summary'] = summary(run)
            engine.persist(run)

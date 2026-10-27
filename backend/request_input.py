"""Parse pasted JSON/curl as data only; never execute a shell command."""
import json
import re
import shlex

ALLOWED = set('model messages stream stream_options max_tokens max_completion_tokens temperature top_p top_k min_p seed stop presence_penalty frequency_penalty repetition_penalty chat_template_kwargs response_format tools tool_choice parallel_tool_calls logprobs top_logprobs n min_tokens ignore_eos skip_special_tokens spaces_between_special_tokens'.split())


def parse_input(text):
    if not isinstance(text, str) or not text.strip() or len(text) > 1_000_000:
        raise ValueError('En fazla 1 milyon karakterlik JSON veya curl isteği girin.')
    text = text.replace('\u00a0', ' ').strip()
    url, timeout = None, None
    if text.startswith('{'):
        body = json.loads(text)
    else:
        if not text.startswith('curl '):
            raise ValueError('JSON nesnesi veya curl komutu yapıştırın.')
        text = re.sub(r'\\\r?\n', '\n', text)
        heredoc = re.search(r"<<\s*['\"]?(\w+)['\"]?\s*\n", text)
        command = text[:heredoc.start()] if heredoc else text
        tokens = shlex.split(command)
        for i, token in enumerate(tokens):
            if token.startswith(('http://', 'https://')):
                url = token
            if token == '--max-time' and i + 1 < len(tokens):
                try:
                    timeout = float(tokens[i + 1])
                except ValueError:
                    raise ValueError('curl --max-time sayısal olmalıdır.')
        if heredoc:
            rest = text[heredoc.end():]
            end = re.search(r'^' + re.escape(heredoc.group(1)) + r'\s*$', rest, re.M)
            if not end:
                raise ValueError('curl JSON bitiş etiketi bulunamadı.')
            body = json.loads(rest[:end.start()])
        else:
            raw = None
            for i, token in enumerate(tokens):
                if token in ('-d', '--data', '--data-raw', '--data-binary') and i + 1 < len(tokens):
                    raw = tokens[i + 1]
            if not raw or raw.startswith('@'):
                raise ValueError('curl içine doğrudan JSON veya <<JSON bloğu ekleyin; dosya okunmaz.')
            body = json.loads(raw)
    validate_payload(body)
    return {'payload': body, 'url': url, 'timeout': timeout}


def validate_payload(body):
    if not isinstance(body, dict) or set(body) - ALLOWED:
        raise ValueError('Geçerli bir chat/completions JSON gövdesi girin; desteklenmeyen alan var.')
    messages = body.get('messages')
    if not isinstance(messages, list) or not messages or any(not isinstance(m, dict) or m.get('role') not in ('system', 'user', 'assistant', 'tool', 'developer') or not isinstance(m.get('content'), str) for m in messages):
        raise ValueError('messages alanı dolu olmalı; her mesaj role ve metin content içermeli.')
    if len(json.dumps(body)) > 6_000_000:
        raise ValueError('İstek gövdesi çok büyük.')
    if type(body.get('stream', True)) is not bool:
        raise ValueError('stream true veya false olmalıdır.')
    for field in ('max_tokens', 'max_completion_tokens'):
        if field in body and (type(body[field]) is not int or not 1 <= body[field] <= 32768):
            raise ValueError(field + ' 1–32768 arasında olmalıdır.')
    if body.get('n', 1) != 1:
        raise ValueError('Bu testte n=1 kullanılmalıdır.')
    if 'model' in body and not isinstance(body['model'], str):
        raise ValueError('model metin olmalıdır.')
    if 'stream_options' in body and not isinstance(body['stream_options'], dict):
        raise ValueError('stream_options JSON nesnesi olmalıdır.')
    if 'chat_template_kwargs' in body and not isinstance(body['chat_template_kwargs'], dict):
        raise ValueError('chat_template_kwargs JSON nesnesi olmalıdır.')

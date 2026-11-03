"""Explicitly loaded prompt examples; never seed user tables on deployment."""
from functools import lru_cache
import hashlib
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parents[1] / 'examples'
EXAMPLES = {
    'turkish-32k': ('Türkçe hasar dosyaları · 32K', 'turkce_sorular_32k.txt', 32768),
    'turkish-64k': ('Türkçe hasar dosyaları · 64K', 'turkce_sorular_64k.txt', 65536),
}


@lru_cache(maxsize=2)
def example(ident):
    if ident not in EXAMPLES:
        return None
    name, filename, target = EXAMPLES[ident]
    data = (DIRECTORY / filename).read_bytes()
    content = data.decode('utf-8')
    return {'id': ident, 'name': name, 'filename': filename, 'category': 'Örnek · Sigorta',
            'target_tokens': target, 'characters': len(content),
            'sha256': hashlib.sha256(data).hexdigest(), 'content': content}


def summaries():
    return [{k: v for k, v in example(ident).items() if k != 'content'} for ident in EXAMPLES]

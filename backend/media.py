"""Validated visual inputs and immutable media shared by records and reports."""
import base64
import binascii
import hashlib
import re
import struct
import threading
import zlib
from functools import lru_cache
from urllib.parse import urlsplit

MAX_IMAGE_BYTES = 5_000_000
MAX_IMAGES = 8
DATA_IMAGE = re.compile(r'data:(image/(?:png|jpeg|webp|gif|bmp|tiff));base64,')
MEDIA_ID = re.compile(r'[a-f0-9]{64}')


def image_bytes(url):
    match = DATA_IMAGE.match(url) if isinstance(url, str) else None
    if not match or len(url) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 40:
        raise ValueError('Görsel PNG, JPEG, WebP, GIF, BMP veya TIFF biçiminde ve en fazla 5 MB olmalıdır.')
    mime = match[1]
    try:
        data = base64.b64decode(url[match.end():], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError('Görselin base64 verisi geçersiz.') from exc
    signatures = {
        'image/png': data.startswith(b'\x89PNG\r\n\x1a\n'),
        'image/jpeg': data.startswith(b'\xff\xd8\xff'),
        'image/webp': data.startswith(b'RIFF') and data[8:12] == b'WEBP',
        'image/gif': data.startswith((b'GIF87a', b'GIF89a')),
        'image/bmp': data.startswith(b'BM'),
        'image/tiff': data.startswith((b'II*\x00', b'MM\x00*')),
    }
    if len(data) < 16 or len(data) > MAX_IMAGE_BYTES or not signatures[mime]:
        raise ValueError('Görsel dosyası seçilen biçimle uyuşmuyor veya 5 MB sınırını aşıyor.')
    return mime, data


def remote_image_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise ValueError('Geçerli bir HTTP(S) görsel adresi girin.')
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise ValueError('Görsel adresi HTTP(S) olmalı ve kullanıcı bilgisi içermemelidir.')
    return value


def image_refs(value):
    if not isinstance(value, list) or len(value) > MAX_IMAGES:
        raise ValueError(f'Bir girdiye en fazla {MAX_IMAGES} görsel eklenebilir.')
    refs = []
    for entry in value:
        if not isinstance(entry, dict) or not isinstance(entry.get('name', ''), str):
            raise ValueError('Geçersiz görsel kaydı.')
        name = entry.get('name', '').strip()[:160] or 'Görsel'
        ident = entry.get('id')
        if isinstance(ident, str) and MEDIA_ID.fullmatch(ident) and 'url' not in entry:
            refs.append({'id': ident, 'name': name})
        elif 'url' in entry and 'id' not in entry:
            refs.append({'url': remote_image_url(entry['url']), 'name': name})
        else:
            raise ValueError('Geçersiz görsel kimliği veya adresi.')
    return refs


def vision_content(text, urls):
    parts = [{'type': 'image_url', 'image_url': {'url': url}} for url in urls]
    if text.strip():
        parts.append({'type': 'text', 'text': text})
    return parts


def model_input_format(model):
    configured = model.get('input_format', 'auto')
    if configured != 'auto':
        return configured
    name = re.sub(r'[^a-z0-9]', '', model['model'].lower())
    return 'ocr' if 'lightonocr' in name else 'auto'


@lru_cache(maxsize=1)
def probe_image_url():
    # Small, deterministic image for the model connection check.
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    rows = b''.join(b'\x00' + bytes(0 if 22 <= x <= 89 and y in range(45, 61) else 255 for x in range(112))
                    for y in range(112))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 112, 112, 8, 0, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    return data_url('image/png', png)


def data_url(mime, data):
    return f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')


class MediaAssets:
    def __init__(self, connect):
        self.connect = connect
        self.lock = threading.Lock()
        self._cached_url = lru_cache(maxsize=16)(self._read_url)

    def add(self, body):
        mime, data = image_bytes(body.get('data_url'))
        ident = hashlib.sha256(data).hexdigest()
        name = body.get('name', '')
        if not isinstance(name, str):
            raise ValueError('Görsel adı metin olmalıdır.')
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO media_assets VALUES (?, ?, ?)', (ident, mime, data))
        return {'id': ident, 'name': name.strip()[:160] or 'Görsel'}

    def get(self, ident):
        with self.connect() as db:
            return db.execute('SELECT mime, data FROM media_assets WHERE id = ?', (ident,)).fetchone()

    def check(self, refs):
        ids = {ref['id'] for ref in refs if 'id' in ref}
        if ids:
            with self.connect() as db:
                if any(not db.execute('SELECT 1 FROM media_assets WHERE id = ?', (ident,)).fetchone() for ident in ids):
                    raise ValueError('Görsellerden biri bulunamadı. Dosyayı yeniden ekleyin.')

    def _read_url(self, ident):
        stored = self.get(ident)
        if not stored:
            raise ValueError('Görsel dosyası bulunamadı.')
        return data_url(*stored)

    def url(self, ref):
        if 'id' not in ref:
            return ref['url']
        with self.lock:
            return self._cached_url(ref['id'])

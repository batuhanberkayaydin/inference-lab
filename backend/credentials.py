"""Owner-only local credential files. Standard library only; no encryption claim."""
import os
from pathlib import Path
import re
import secrets


class CredentialFiles:
    PREFIX = 'local-file-v1:'

    def __init__(self, directory):
        self.directory = Path(directory) / 'credentials'
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)

    @classmethod
    def is_reference(cls, value):
        return isinstance(value, str) and re.fullmatch(r'local-file-v1:[a-f0-9]{32}', value) is not None

    def _path(self, reference):
        if not self.is_reference(reference):
            raise ValueError('Bu API anahtarı eski sürümde şifrelenmiş. Yönetici ayarlarında modelin API anahtarını yeniden girip kaydedin.')
        return self.directory / (reference[len(self.PREFIX):] + '.txt')

    def save(self, value):
        if not isinstance(value, str) or not value or len(value) > 8192 or '\r' in value or '\n' in value:
            raise ValueError('API anahtarı 1–8192 karakterlik tek satır metin olmalıdır.')
        reference = self.PREFIX + secrets.token_hex(16)
        path = self._path(reference)
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
                handle.write(value)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return reference

    def read(self, reference):
        if not reference:
            return ''
        path = self._path(reference)
        try:
            descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(descriptor, 'r', encoding='utf-8') as handle:
                if hasattr(os, 'fchmod'):
                    os.fchmod(handle.fileno(), 0o600)
                else:
                    os.chmod(path, 0o600)
                value = handle.read(8193)
        except (OSError, UnicodeError):
            raise ValueError('Kayıtlı API anahtarı okunamadı. Yönetici ayarlarında modelin anahtarını yeniden girip kaydedin.') from None
        if not value or len(value) > 8192 or '\r' in value or '\n' in value:
            raise ValueError('Kayıtlı API anahtarı geçersiz. Yönetici ayarlarında modelin anahtarını yeniden girip kaydedin.')
        return value

    def remove(self, reference):
        # Never delete legacy ciphertext or credential.key: other old models may need them.
        if self.is_reference(reference):
            self._path(reference).unlink(missing_ok=True)

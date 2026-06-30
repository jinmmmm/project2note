import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    from app.config import settings
    raw = hashlib.sha256(settings.auth_secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return plaintext
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted secret. Falls back to returning the value as-is
    so existing plaintext rows in the DB (before this change) continue to work."""
    if not ciphertext:
        return ciphertext
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        return ciphertext

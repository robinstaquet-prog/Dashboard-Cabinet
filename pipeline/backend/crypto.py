"""
Crypto module — AES-256-GCM with password-derived keys (PBKDF2-HMAC-SHA256).

Binary format on disk:
  salt (16 bytes) | nonce (12 bytes) | ciphertext+tag (variable)

Key never written to disk. Decryption always returns bytes in memory.
"""
from __future__ import annotations

import os
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

SALT_SIZE = 16
NONCE_SIZE = 12
KEY_SIZE = 32       # AES-256
ITERATIONS = 600_000


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def derive_key(password: str, salt: bytes) -> bytes:
    """Derive a 256-bit key from *password* and *salt* via PBKDF2-HMAC-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_SIZE,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_bytes(data: bytes, password: str) -> bytes:
    """Return encrypted blob (salt | nonce | ciphertext+tag)."""
    salt = os.urandom(SALT_SIZE)
    nonce = os.urandom(NONCE_SIZE)
    key = derive_key(password, salt)
    ciphertext = AESGCM(key).encrypt(nonce, data, None)
    return salt + nonce + ciphertext


def decrypt_bytes(blob: bytes, password: str) -> bytes:
    """Decrypt blob produced by *encrypt_bytes*. Raises ValueError on bad password."""
    if len(blob) < SALT_SIZE + NONCE_SIZE + 16:
        raise ValueError("Blob too short — corrupted or wrong format.")
    salt = blob[:SALT_SIZE]
    nonce = blob[SALT_SIZE: SALT_SIZE + NONCE_SIZE]
    ciphertext = blob[SALT_SIZE + NONCE_SIZE:]
    key = derive_key(password, salt)
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag as exc:
        raise ValueError("Decryption failed — wrong password or corrupted data.") from exc


# ---------------------------------------------------------------------------
# File-level helpers
# ---------------------------------------------------------------------------

def encrypt_file(path: Path, password: str) -> None:
    """Encrypt *path* in-place (overwrites with encrypted blob)."""
    data = path.read_bytes()
    path.write_bytes(encrypt_bytes(data, password))


def decrypt_file_to_memory(path: Path, password: str) -> bytes:
    """Read encrypted file and return plaintext bytes. Never writes plaintext to disk."""
    return decrypt_bytes(path.read_bytes(), password)


def encrypt_json_to_file(obj: dict | list, path: Path, password: str) -> None:
    """Serialize *obj* to JSON and encrypt it to *path*."""
    import json
    raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    path.write_bytes(encrypt_bytes(raw, password))


def decrypt_json_from_file(path: Path, password: str) -> dict | list:
    """Decrypt *path* and deserialize JSON. Returns dict or list."""
    import json
    raw = decrypt_file_to_memory(path, password)
    return json.loads(raw.decode("utf-8"))

"""
Tests unitaires pour backend/crypto.py
Run: pytest pipeline/backend/tests/test_crypto.py -v
"""
import json
import pytest
from pathlib import Path

# Allow running from repo root without installing the package
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from pipeline.backend.crypto import (
    derive_key,
    encrypt_bytes,
    decrypt_bytes,
    encrypt_file,
    decrypt_file_to_memory,
    encrypt_json_to_file,
    decrypt_json_from_file,
    SALT_SIZE,
    NONCE_SIZE,
    KEY_SIZE,
)


# ---------------------------------------------------------------------------
# derive_key
# ---------------------------------------------------------------------------

class TestDeriveKey:
    def test_returns_32_bytes(self):
        key = derive_key("password", b"0123456789abcdef")
        assert len(key) == KEY_SIZE

    def test_deterministic(self):
        salt = b"abcdefghijklmnop"
        k1 = derive_key("pw", salt)
        k2 = derive_key("pw", salt)
        assert k1 == k2

    def test_different_password_different_key(self):
        salt = b"abcdefghijklmnop"
        assert derive_key("pw1", salt) != derive_key("pw2", salt)

    def test_different_salt_different_key(self):
        assert derive_key("pw", b"aaaaaaaaaaaaaaaa") != derive_key("pw", b"bbbbbbbbbbbbbbbb")


# ---------------------------------------------------------------------------
# encrypt_bytes / decrypt_bytes
# ---------------------------------------------------------------------------

class TestEncryptDecryptBytes:
    def test_roundtrip(self):
        data = b"Donnee sensible du patient"
        blob = encrypt_bytes(data, "motdepasse")
        assert decrypt_bytes(blob, "motdepasse") == data

    def test_ciphertext_differs_from_plaintext(self):
        data = b"Donnee sensible"
        blob = encrypt_bytes(data, "pw")
        assert blob != data
        assert data not in blob  # plaintext must not appear in blob

    def test_two_encryptions_differ(self):
        """Random salt + nonce: same input must produce different blobs."""
        data = b"test"
        blob1 = encrypt_bytes(data, "pw")
        blob2 = encrypt_bytes(data, "pw")
        assert blob1 != blob2

    def test_blob_structure_size(self):
        data = b"x" * 64
        blob = encrypt_bytes(data, "pw")
        # salt + nonce + 64 bytes data + 16 bytes GCM tag
        assert len(blob) == SALT_SIZE + NONCE_SIZE + 64 + 16

    def test_wrong_password_raises_value_error(self):
        blob = encrypt_bytes(b"secret", "correct")
        with pytest.raises(ValueError, match="Decryption failed"):
            decrypt_bytes(blob, "wrong")

    def test_truncated_blob_raises_value_error(self):
        with pytest.raises(ValueError, match="too short"):
            decrypt_bytes(b"\x00" * 10, "pw")

    def test_tampered_blob_raises(self):
        blob = bytearray(encrypt_bytes(b"data", "pw"))
        blob[-1] ^= 0xFF  # flip last byte
        with pytest.raises(ValueError):
            decrypt_bytes(bytes(blob), "pw")

    def test_empty_payload(self):
        blob = encrypt_bytes(b"", "pw")
        assert decrypt_bytes(blob, "pw") == b""

    def test_unicode_password(self):
        data = b"patient info"
        blob = encrypt_bytes(data, "mötdëpässé!@#")
        assert decrypt_bytes(blob, "mötdëpässé!@#") == data

    def test_large_payload(self):
        data = b"A" * 1_000_000
        blob = encrypt_bytes(data, "pw")
        assert decrypt_bytes(blob, "pw") == data


# ---------------------------------------------------------------------------
# File-level helpers
# ---------------------------------------------------------------------------

class TestEncryptDecryptFile:
    def test_encrypt_file_in_place(self, tmp_path):
        f = tmp_path / "patient.docx"
        original = b"Patient: Marie Dupont"
        f.write_bytes(original)

        encrypt_file(f, "secret")

        assert f.read_bytes() != original
        assert original not in f.read_bytes()

    def test_decrypt_file_to_memory(self, tmp_path):
        f = tmp_path / "patient.docx"
        original = b"Patient: Marie Dupont"
        f.write_bytes(original)

        encrypt_file(f, "secret")
        result = decrypt_file_to_memory(f, "secret")

        assert result == original

    def test_decrypt_wrong_password_raises(self, tmp_path):
        f = tmp_path / "data.bin"
        f.write_bytes(encrypt_bytes(b"data", "correct"))
        with pytest.raises(ValueError):
            decrypt_file_to_memory(f, "wrong")


# ---------------------------------------------------------------------------
# JSON helpers (mapping.enc use-case)
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    MAPPING = {
        "P0001": {"prenom_nom": "Marie Dupont", "date_naissance": "1980-05-12"},
        "P0002": {"prenom_nom": "Jean Martin", "date_naissance": "1975-03-22"},
    }

    def test_json_roundtrip(self, tmp_path):
        f = tmp_path / "mapping.enc"
        encrypt_json_to_file(self.MAPPING, f, "master_pw")
        result = decrypt_json_from_file(f, "master_pw")
        assert result == self.MAPPING

    def test_json_file_not_readable_as_text(self, tmp_path):
        f = tmp_path / "mapping.enc"
        encrypt_json_to_file(self.MAPPING, f, "master_pw")
        raw = f.read_bytes()
        # Must not contain recognizable plaintext
        assert b"Marie Dupont" not in raw
        assert b"P0001" not in raw

    def test_json_wrong_password(self, tmp_path):
        f = tmp_path / "mapping.enc"
        encrypt_json_to_file(self.MAPPING, f, "correct")
        with pytest.raises(ValueError):
            decrypt_json_from_file(f, "wrong")

    def test_json_list_payload(self, tmp_path):
        f = tmp_path / "list.enc"
        payload = [1, "deux", {"trois": 3}]
        encrypt_json_to_file(payload, f, "pw")
        assert decrypt_json_from_file(f, "pw") == payload

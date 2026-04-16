"""
Tests unitaires pour backend/compressor.py
Run: pytest pipeline/backend/tests/test_compressor.py -v
"""
import io
import struct
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from pipeline.backend.compressor import (
    MAX_HEIGHT,
    MAX_WIDTH,
    JPEG_QUALITY,
    compress,
    compress_many,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_jpeg(width: int, height: int, color=(200, 100, 50)) -> bytes:
    """Génère un JPEG synthétique en mémoire."""
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def make_png_rgba(width: int, height: int) -> bytes:
    """Génère un PNG RGBA synthétique."""
    img = Image.new("RGBA", (width, height), color=(10, 20, 30, 128))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def image_size(data: bytes) -> tuple[int, int]:
    """Retourne (width, height) d'un JPEG/PNG en bytes."""
    return Image.open(io.BytesIO(data)).size


def is_jpeg(data: bytes) -> bool:
    return data[:2] == b"\xff\xd8"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCompress:

    # --- Format de sortie ---

    def test_output_is_valid_jpeg(self):
        result = compress(make_jpeg(800, 600))
        assert is_jpeg(result)

    def test_output_is_jpeg_from_png_rgba(self):
        result = compress(make_png_rgba(400, 300))
        assert is_jpeg(result)

    def test_output_is_jpeg_from_file(self, tmp_path):
        f = tmp_path / "photo.jpg"
        f.write_bytes(make_jpeg(640, 480))
        result = compress(f)
        assert is_jpeg(result)

    # --- Redimensionnement : images trop grandes ---

    def test_landscape_wider_than_max_is_resized(self):
        # 2560×1440 → doit tenir dans 1280×960
        result = compress(make_jpeg(2560, 1440))
        w, h = image_size(result)
        assert w <= MAX_WIDTH
        assert h <= MAX_HEIGHT

    def test_portrait_taller_than_max_is_resized(self):
        # 720×1920 → doit tenir dans 1280×960
        result = compress(make_jpeg(720, 1920))
        w, h = image_size(result)
        assert w <= MAX_WIDTH
        assert h <= MAX_HEIGHT

    def test_square_image_resized(self):
        result = compress(make_jpeg(2000, 2000))
        w, h = image_size(result)
        assert w <= MAX_WIDTH
        assert h <= MAX_HEIGHT

    def test_exact_max_dimensions_not_changed(self):
        result = compress(make_jpeg(MAX_WIDTH, MAX_HEIGHT))
        w, h = image_size(result)
        assert w == MAX_WIDTH
        assert h == MAX_HEIGHT

    # --- Ratio conservé ---

    def test_aspect_ratio_preserved_landscape(self):
        # 2560×1280 (ratio 2:1) → après resize doit rester 2:1
        result = compress(make_jpeg(2560, 1280))
        w, h = image_size(result)
        assert abs(w / h - 2.0) < 0.02

    def test_aspect_ratio_preserved_portrait(self):
        # 960×1920 (ratio 1:2)
        result = compress(make_jpeg(960, 1920))
        w, h = image_size(result)
        assert abs(h / w - 2.0) < 0.02

    # --- Pas d'agrandissement ---

    def test_small_image_not_upscaled(self):
        result = compress(make_jpeg(320, 240))
        w, h = image_size(result)
        assert w == 320
        assert h == 240

    def test_tiny_image_not_upscaled(self):
        result = compress(make_jpeg(100, 100))
        w, h = image_size(result)
        assert w == 100
        assert h == 100

    # --- Modes couleur ---

    def test_rgba_converted_to_rgb(self):
        result = compress(make_png_rgba(400, 300))
        img = Image.open(io.BytesIO(result))
        assert img.mode == "RGB"

    def test_grayscale_converted_to_rgb(self):
        grey = Image.new("L", (800, 600), color=128)
        buf = io.BytesIO()
        grey.save(buf, format="JPEG")
        result = compress(buf.getvalue())
        img = Image.open(io.BytesIO(result))
        assert img.mode == "RGB"

    # --- Entrée Path vs bytes ---

    def test_accepts_path_object(self, tmp_path):
        f = tmp_path / "img.jpg"
        f.write_bytes(make_jpeg(1600, 1200))
        result = compress(f)
        w, h = image_size(result)
        assert w <= MAX_WIDTH and h <= MAX_HEIGHT

    def test_accepts_bytes(self):
        raw = make_jpeg(1600, 1200)
        result = compress(raw)
        assert is_jpeg(result)

    # --- Réduction de taille ---

    def test_large_image_is_smaller_after_compress(self):
        raw = make_jpeg(3000, 2000)
        result = compress(raw)
        assert len(result) < len(raw)


class TestCompressMany:
    def test_returns_list_of_same_length(self):
        images = [make_jpeg(800, 600) for _ in range(3)]
        results = compress_many(images)
        assert len(results) == 3

    def test_each_result_is_jpeg(self):
        images = [make_jpeg(800 + i * 100, 600) for i in range(3)]
        for result in compress_many(images):
            assert is_jpeg(result)

    def test_empty_list(self):
        assert compress_many([]) == []

    def test_single_image(self):
        results = compress_many([make_jpeg(2000, 1500)])
        assert len(results) == 1
        w, h = image_size(results[0])
        assert w <= MAX_WIDTH and h <= MAX_HEIGHT

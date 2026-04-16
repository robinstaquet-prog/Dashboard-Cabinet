"""Tests pour photo_watcher — détection et groupement des photos de fiches."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from backend.photo_watcher import (
    DEFAULT_MAX_AGE_DAYS,
    DEFAULT_MIN_SIZE_KB,
    _parse_stem,
    scan,
)

# Timestamp fictif fixe pour tous les tests d'âge
NOW = 1_000_000.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make(path: Path, size_kb: int = 50, age_seconds: float = 120) -> Path:
    """Crée un fichier avec taille et âge contrôlés."""
    path.write_bytes(b"F" * size_kb * 1024)
    mtime = NOW - age_seconds
    os.utime(path, (mtime, mtime))
    return path


# ---------------------------------------------------------------------------
# _parse_stem — extraction (prenom_nom, page)
# ---------------------------------------------------------------------------

class TestParseStem:
    def test_simple_name(self):
        assert _parse_stem("Marie Dupont") == ("Marie Dupont", 1)

    def test_name_with_page_2(self):
        assert _parse_stem("Marie Dupont 2") == ("Marie Dupont", 2)

    def test_name_with_large_page(self):
        assert _parse_stem("Jean Martin 10") == ("Jean Martin", 10)

    def test_hyphenated_first_name(self):
        assert _parse_stem("Jean-Pierre Martin") == ("Jean-Pierre Martin", 1)

    def test_hyphenated_with_page(self):
        assert _parse_stem("Jean-Pierre Martin 3") == ("Jean-Pierre Martin", 3)

    def test_three_word_name(self):
        assert _parse_stem("Marie Anne Dupont") == ("Marie Anne Dupont", 1)

    def test_leading_trailing_spaces_stripped(self):
        assert _parse_stem("  Marie Dupont  ") == ("Marie Dupont", 1)

    def test_single_word_rejected(self):
        assert _parse_stem("Rapport") is None

    def test_img_filename_rejected(self):
        assert _parse_stem("IMG_1234") is None

    def test_screenshot_rejected(self):
        assert _parse_stem("Screenshot_20240101") is None

    def test_only_digit_rejected(self):
        assert _parse_stem("2") is None

    def test_page_defaults_to_1(self):
        _, page = _parse_stem("Alice Bob")
        assert page == 1

    def test_page_number_extracted(self):
        _, page = _parse_stem("Alice Bob 5")
        assert page == 5

    def test_name_preserved_exactly(self):
        name, _ = _parse_stem("Élodie Müller 2")
        assert name == "Élodie Müller"


# ---------------------------------------------------------------------------
# scan — filtre par extension
# ---------------------------------------------------------------------------

class TestScanExtension:
    def test_jpg_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_jpeg_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpeg")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_png_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.png")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_heic_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.heic")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_heif_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.heif")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_pdf_goes_to_ignored(self, tmp_path):
        _make(tmp_path / "Marie Dupont.pdf")
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert len(r.ignored) == 1

    def test_docx_goes_to_ignored(self, tmp_path):
        _make(tmp_path / "Marie Dupont.docx")
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert len(r.ignored) == 1

    def test_extension_uppercase_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.JPG")
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_extension_mixed_case_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.Jpeg")
        assert len(scan(tmp_path, _now=NOW).batches) == 1


# ---------------------------------------------------------------------------
# scan — filtre par taille
# ---------------------------------------------------------------------------

class TestScanSize:
    def test_file_below_min_size_ignored(self, tmp_path):
        p = tmp_path / "Marie Dupont.jpg"
        p.write_bytes(b"x" * 100)  # 0.1 Ko << 10 Ko
        os.utime(p, (NOW - 120, NOW - 120))
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert p in r.ignored

    def test_file_at_exactly_min_size_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg", size_kb=DEFAULT_MIN_SIZE_KB)
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_file_above_min_size_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg", size_kb=500)
        assert len(scan(tmp_path, _now=NOW).batches) == 1


# ---------------------------------------------------------------------------
# scan — filtre par âge
# ---------------------------------------------------------------------------

class TestScanAge:
    def test_too_recent_goes_to_too_recent(self, tmp_path):
        p = _make(tmp_path / "Marie Dupont.jpg", age_seconds=10)
        r = scan(tmp_path, _now=NOW, min_age_seconds=30)
        assert r.batches == []
        assert p in r.too_recent

    def test_at_exactly_min_age_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg", age_seconds=30)
        r = scan(tmp_path, _now=NOW, min_age_seconds=30)
        assert len(r.batches) == 1

    def test_too_old_goes_to_too_old(self, tmp_path):
        old_age = (DEFAULT_MAX_AGE_DAYS + 1) * 86400
        p = _make(tmp_path / "Marie Dupont.jpg", age_seconds=old_age)
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert p in r.too_old

    def test_at_exactly_max_age_accepted(self, tmp_path):
        age = DEFAULT_MAX_AGE_DAYS * 86400
        _make(tmp_path / "Marie Dupont.jpg", age_seconds=age)
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_within_window_accepted(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg", age_seconds=3600)  # 1h
        assert len(scan(tmp_path, _now=NOW).batches) == 1

    def test_too_recent_not_in_batches_nor_ignored(self, tmp_path):
        p = _make(tmp_path / "Marie Dupont.jpg", age_seconds=5)
        r = scan(tmp_path, _now=NOW, min_age_seconds=30)
        assert p not in r.ignored
        assert p not in r.too_old

    def test_too_old_not_in_batches_nor_ignored(self, tmp_path):
        p = _make(tmp_path / "Marie Dupont.jpg", age_seconds=999 * 86400)
        r = scan(tmp_path, _now=NOW)
        assert p not in r.ignored
        assert p not in r.too_recent


# ---------------------------------------------------------------------------
# scan — filtre par nom
# ---------------------------------------------------------------------------

class TestScanName:
    def test_no_space_goes_to_ignored(self, tmp_path):
        p = _make(tmp_path / "IMG_1234.jpg")
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert p in r.ignored

    def test_valid_name_creates_batch(self, tmp_path):
        _make(tmp_path / "Alice Bob.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 1
        assert r.batches[0].prenom_nom == "Alice Bob"

    def test_name_with_accents_accepted(self, tmp_path):
        _make(tmp_path / "Élodie Müller.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 1
        assert r.batches[0].prenom_nom == "Élodie Müller"


# ---------------------------------------------------------------------------
# scan — groupement et tri
# ---------------------------------------------------------------------------

class TestScanGrouping:
    def test_single_photo_batch(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 1
        assert len(r.batches[0].files) == 1

    def test_multiple_pages_grouped_together(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg")
        _make(tmp_path / "Marie Dupont 2.jpg")
        _make(tmp_path / "Marie Dupont 3.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 1
        assert len(r.batches[0].files) == 3

    def test_pages_sorted_by_number_asc(self, tmp_path):
        _make(tmp_path / "Marie Dupont 3.jpg")
        _make(tmp_path / "Marie Dupont.jpg")
        _make(tmp_path / "Marie Dupont 2.jpg")
        r = scan(tmp_path, _now=NOW)
        stems = [f.stem for f in r.batches[0].files]
        assert stems == ["Marie Dupont", "Marie Dupont 2", "Marie Dupont 3"]

    def test_two_patients_two_batches(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg")
        _make(tmp_path / "Jean Martin.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 2
        names = {b.prenom_nom for b in r.batches}
        assert names == {"Marie Dupont", "Jean Martin"}

    def test_batches_sorted_alphabetically(self, tmp_path):
        _make(tmp_path / "Zara Smith.jpg")
        _make(tmp_path / "Alice Bob.jpg")
        r = scan(tmp_path, _now=NOW)
        assert r.batches[0].prenom_nom == "Alice Bob"
        assert r.batches[1].prenom_nom == "Zara Smith"

    def test_pages_from_different_patients_not_mixed(self, tmp_path):
        _make(tmp_path / "Marie Dupont 2.jpg")
        _make(tmp_path / "Jean Martin.jpg")
        _make(tmp_path / "Marie Dupont.jpg")
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 2
        md = next(b for b in r.batches if b.prenom_nom == "Marie Dupont")
        jm = next(b for b in r.batches if b.prenom_nom == "Jean Martin")
        assert len(md.files) == 2
        assert len(jm.files) == 1


# ---------------------------------------------------------------------------
# scan — cas limites
# ---------------------------------------------------------------------------

class TestScanEdgeCases:
    def test_empty_folder(self, tmp_path):
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []
        assert r.too_recent == []
        assert r.too_old == []
        assert r.ignored == []

    def test_subdirectory_not_included(self, tmp_path):
        sub = tmp_path / "Marie Dupont"
        sub.mkdir()
        r = scan(tmp_path, _now=NOW)
        assert r.batches == []

    def test_mixed_valid_and_invalid_files(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg")      # OK
        _make(tmp_path / "IMG_1234.jpg")           # ignored (nom sans espace)
        _make(tmp_path / "notes.txt")              # ignored (extension)
        p_small = tmp_path / "Jean Martin.jpg"
        p_small.write_bytes(b"x" * 100)            # ignored (trop petit)
        os.utime(p_small, (NOW - 120, NOW - 120))
        r = scan(tmp_path, _now=NOW)
        assert len(r.batches) == 1
        assert r.batches[0].prenom_nom == "Marie Dupont"
        assert len(r.ignored) == 3

    def test_custom_max_age_days(self, tmp_path):
        # Vieux de 3 jours → OK avec max_age_days=7, rejeté avec max_age_days=2
        age = 3 * 86400
        p = _make(tmp_path / "Marie Dupont.jpg", age_seconds=age)
        r_ok = scan(tmp_path, _now=NOW, max_age_days=7)
        r_ko = scan(tmp_path, _now=NOW, max_age_days=2)
        assert len(r_ok.batches) == 1
        assert p in r_ko.too_old

    def test_custom_min_age_seconds(self, tmp_path):
        # Vieux de 60s → ignoré avec min_age=120, accepté avec min_age=30
        _make(tmp_path / "Marie Dupont.jpg", age_seconds=60)
        r_ko = scan(tmp_path, _now=NOW, min_age_seconds=120)
        r_ok = scan(tmp_path, _now=NOW, min_age_seconds=30)
        assert r_ko.batches == []
        assert len(r_ok.batches) == 1

    def test_custom_min_size_kb(self, tmp_path):
        _make(tmp_path / "Marie Dupont.jpg", size_kb=5)  # 5 Ko
        r_ko = scan(tmp_path, _now=NOW, min_size_kb=10)
        r_ok = scan(tmp_path, _now=NOW, min_size_kb=4)
        assert r_ko.batches == []
        assert len(r_ok.batches) == 1

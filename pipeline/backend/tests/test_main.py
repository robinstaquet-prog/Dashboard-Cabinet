"""Tests FastAPI — endpoints /health, /pipeline/scan, /archive/status, /archive/cleanup."""
from __future__ import annotations

import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_ENV = {
    "PIPELINE_PASSWORD": "test-password",
    "PIPELINE_DATA_DIR": "",          # sera remplacé par tmp_path
    "PIPELINE_DOWNLOADS_FOLDER": "",  # sera remplacé par tmp_path
    "PIPELINE_ARCHIVE_RETENTION_DAYS": "30",
    "PIPELINE_MAX_AGE_DAYS": "7",
    "PIPELINE_MIN_AGE_SECONDS": "30",
}


def _env(tmp_path: Path, overrides: dict | None = None) -> dict:
    env = {**BASE_ENV}
    env["PIPELINE_DATA_DIR"] = str(tmp_path / "data")
    env["PIPELINE_DOWNLOADS_FOLDER"] = str(tmp_path / "downloads")
    (tmp_path / "downloads").mkdir(parents=True, exist_ok=True)
    if overrides:
        env.update(overrides)
    return env


def _make_archive_file(path: Path, age_seconds: float = 120) -> Path:
    path.write_bytes(b"x" * 50 * 1024)
    mtime = time.time() - age_seconds
    os.utime(path, (mtime, mtime))
    return path


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_ok_with_valid_config(self, tmp_path):
        with patch.dict(os.environ, _env(tmp_path)):
            r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_returns_config_values(self, tmp_path):
        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "14"})
        with patch.dict(os.environ, env):
            r = client.get("/health")
        data = r.json()
        assert data["archive_retention_days"] == 14

    def test_missing_password_returns_500(self, tmp_path):
        env = _env(tmp_path)
        del env["PIPELINE_PASSWORD"]
        with patch.dict(os.environ, env, clear=False):
            # Temporarily remove PIPELINE_PASSWORD from environment
            old = os.environ.pop("PIPELINE_PASSWORD", None)
            try:
                r = client.get("/health")
                assert r.status_code == 500
            finally:
                if old is not None:
                    os.environ["PIPELINE_PASSWORD"] = old


# ---------------------------------------------------------------------------
# GET /pipeline/scan
# ---------------------------------------------------------------------------

class TestPipelineScan:
    def test_empty_downloads_returns_empty_batches(self, tmp_path):
        with patch.dict(os.environ, _env(tmp_path)):
            r = client.get("/pipeline/scan")
        assert r.status_code == 200
        data = r.json()
        assert data["batches"] == []
        assert data["too_recent"] == []
        assert data["too_old"] == []
        assert data["ignored_count"] == 0

    def test_valid_photo_detected(self, tmp_path):
        env = _env(tmp_path)   # crée downloads/
        dl = tmp_path / "downloads"
        p = dl / "Marie Dupont.jpg"
        p.write_bytes(b"x" * 50 * 1024)
        mtime = time.time() - 120
        os.utime(p, (mtime, mtime))

        with patch.dict(os.environ, env):
            r = client.get("/pipeline/scan")
        data = r.json()
        assert len(data["batches"]) == 1
        assert data["batches"][0]["prenom_nom"] == "Marie Dupont"
        assert data["batches"][0]["pages"] == 1

    def test_multipage_batch(self, tmp_path):
        env = _env(tmp_path)   # crée downloads/
        dl = tmp_path / "downloads"
        mtime = time.time() - 120
        for name in ["Marie Dupont.jpg", "Marie Dupont 2.jpg"]:
            p = dl / name
            p.write_bytes(b"x" * 50 * 1024)
            os.utime(p, (mtime, mtime))

        with patch.dict(os.environ, env):
            r = client.get("/pipeline/scan")
        data = r.json()
        assert data["batches"][0]["pages"] == 2

    def test_missing_downloads_folder_returns_404(self, tmp_path):
        env = _env(tmp_path)
        env["PIPELINE_DOWNLOADS_FOLDER"] = str(tmp_path / "nonexistent")
        with patch.dict(os.environ, env):
            r = client.get("/pipeline/scan")
        assert r.status_code == 404

    def test_too_recent_photo_reported(self, tmp_path):
        env = _env(tmp_path)   # crée downloads/
        dl = tmp_path / "downloads"
        p = dl / "Marie Dupont.jpg"
        p.write_bytes(b"x" * 50 * 1024)
        os.utime(p, (time.time() - 5, time.time() - 5))

        with patch.dict(os.environ, env):
            r = client.get("/pipeline/scan")
        data = r.json()
        assert data["batches"] == []
        assert "Marie Dupont.jpg" in data["too_recent"]


# ---------------------------------------------------------------------------
# GET /archive/status
# ---------------------------------------------------------------------------

class TestArchiveStatus:
    def test_no_archive_dir_returns_empty(self, tmp_path):
        with patch.dict(os.environ, _env(tmp_path)):
            r = client.get("/archive/status")
        assert r.status_code == 200
        data = r.json()
        assert data["total_files"] == 0
        assert data["files"] == []

    def test_lists_archive_files(self, tmp_path):
        archive = tmp_path / "data" / "archive"
        archive.mkdir(parents=True)
        _make_archive_file(archive / "Marie Dupont.jpg", age_seconds=2 * 86400)

        with patch.dict(os.environ, _env(tmp_path)):
            r = client.get("/archive/status")
        data = r.json()
        assert data["total_files"] == 1
        assert data["files"][0]["name"] == "Marie Dupont.jpg"
        assert data["files"][0]["age_days"] >= 2.0

    def test_returns_retention_days(self, tmp_path):
        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "14"})
        with patch.dict(os.environ, env):
            r = client.get("/archive/status")
        assert r.json()["retention_days"] == 14


# ---------------------------------------------------------------------------
# POST /archive/cleanup
# ---------------------------------------------------------------------------

class TestArchiveCleanup:
    def test_no_archive_returns_zero_deleted(self, tmp_path):
        with patch.dict(os.environ, _env(tmp_path)):
            r = client.post("/archive/cleanup")
        assert r.status_code == 200
        assert r.json()["deleted_count"] == 0

    def test_recent_files_not_deleted(self, tmp_path):
        archive = tmp_path / "data" / "archive"
        archive.mkdir(parents=True)
        _make_archive_file(archive / "Marie Dupont.jpg", age_seconds=86400)  # 1 jour

        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "30"})
        with patch.dict(os.environ, env):
            r = client.post("/archive/cleanup")
        assert r.json()["deleted_count"] == 0
        assert (archive / "Marie Dupont.jpg").exists()

    def test_old_files_deleted(self, tmp_path):
        archive = tmp_path / "data" / "archive"
        archive.mkdir(parents=True)
        _make_archive_file(archive / "Jean Martin.jpg", age_seconds=31 * 86400)

        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "30"})
        with patch.dict(os.environ, env):
            r = client.post("/archive/cleanup")
        data = r.json()
        assert data["deleted_count"] == 1
        assert "Jean Martin.jpg" in data["deleted_files"]
        assert not (archive / "Jean Martin.jpg").exists()

    def test_zero_retention_skips_cleanup(self, tmp_path):
        archive = tmp_path / "data" / "archive"
        archive.mkdir(parents=True)
        _make_archive_file(archive / "Alice Bob.jpg", age_seconds=999 * 86400)

        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "0"})
        with patch.dict(os.environ, env):
            r = client.post("/archive/cleanup")
        # retention=0 signifie suppression immédiate au moment du traitement,
        # pas via cleanup. cleanup ne fait rien.
        assert r.json()["deleted_count"] == 0

    def test_mixed_ages_only_old_deleted(self, tmp_path):
        archive = tmp_path / "data" / "archive"
        archive.mkdir(parents=True)
        _make_archive_file(archive / "Old Patient.jpg", age_seconds=40 * 86400)
        _make_archive_file(archive / "Recent Patient.jpg", age_seconds=5 * 86400)

        env = _env(tmp_path, {"PIPELINE_ARCHIVE_RETENTION_DAYS": "30"})
        with patch.dict(os.environ, env):
            r = client.post("/archive/cleanup")
        data = r.json()
        assert data["deleted_count"] == 1
        assert "Old Patient.jpg" in data["deleted_files"]
        assert (archive / "Recent Patient.jpg").exists()

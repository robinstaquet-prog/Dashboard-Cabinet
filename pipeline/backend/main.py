"""
FastAPI — API locale du pipeline de numérisation de fiches patients.

Endpoints :
    GET  /health                  Service opérationnel
    GET  /pipeline/scan           Aperçu des photos détectées (sans traitement)
    POST /pipeline/run            Lance le pipeline complet
    POST /archive/cleanup         Purge nLPD des archives expirées
    GET  /archive/status          État des archives (nombre, âge)

Configuration via variables d'environnement :
    PIPELINE_DOWNLOADS_FOLDER        Défaut : ~/Downloads
    PIPELINE_DATA_DIR                Défaut : ./data  (relatif au répertoire courant)
    PIPELINE_PASSWORD                Obligatoire
    ANTHROPIC_API_KEY                Obligatoire pour /pipeline/run
    PIPELINE_MAX_AGE_DAYS            Défaut : 7
    PIPELINE_MIN_AGE_SECONDS         Défaut : 30
    PIPELINE_ARCHIVE_RETENTION_DAYS  Défaut : 30  (0 = suppression immédiate)

Lancement :
    cd pipeline/
    uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .crypto import decrypt_bytes, decrypt_json_from_file
from .docx_generator import save_anonymized, save_normal
from .photo_watcher import scan as watcher_scan
from .pipeline_patient import PipelineConfig, cleanup_archive, run
from .pseudonymizer import anonymize, load_mapping

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration depuis l'environnement
# ---------------------------------------------------------------------------

def _config() -> PipelineConfig:
    """Construit PipelineConfig depuis les variables d'environnement."""
    password = os.environ.get("PIPELINE_PASSWORD", "")
    if not password:
        raise RuntimeError(
            "Variable d'environnement PIPELINE_PASSWORD manquante. "
            "Définissez-la avant de démarrer le serveur."
        )
    return PipelineConfig(
        downloads_folder=Path(
            os.environ.get("PIPELINE_DOWNLOADS_FOLDER", Path.home() / "Downloads")
        ),
        data_dir=Path(os.environ.get("PIPELINE_DATA_DIR", "data")),
        password=password,
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
        max_age_days=int(os.environ.get("PIPELINE_MAX_AGE_DAYS", "7")),
        min_age_seconds=int(os.environ.get("PIPELINE_MIN_AGE_SECONDS", "30")),
        archive_retention_days=int(
            os.environ.get("PIPELINE_ARCHIVE_RETENTION_DAYS", "30")
        ),
    )


# ---------------------------------------------------------------------------
# Schémas de réponse
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    downloads_folder: str
    data_dir: str
    archive_retention_days: int


class BatchInfo(BaseModel):
    prenom_nom: str
    pages: int
    files: list[str]


class ScanResponse(BaseModel):
    batches: list[BatchInfo]
    too_recent: list[str]
    too_old: list[str]
    ignored_count: int


class BatchResultResponse(BaseModel):
    prenom_nom: str
    code: str
    code_created: bool
    photos_archived: int
    photos_deleted: int


class RunResponse(BaseModel):
    processed: list[BatchResultResponse]
    errors: list[dict]
    scan_summary: dict


class ArchiveFile(BaseModel):
    name: str
    age_days: float


class ArchiveStatusResponse(BaseModel):
    total_files: int
    retention_days: int
    files: list[ArchiveFile]


class CleanupResponse(BaseModel):
    deleted_count: int
    deleted_files: list[str]


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _lifespan(application: FastAPI):
    """Purge les archives expirées au démarrage du serveur."""
    try:
        cfg = _config()
        log.info("Dossier Téléchargements : %s", cfg.downloads_folder)
        log.info("Dossier data           : %s", cfg.data_dir)
        log.info("Rétention archives     : %d jour(s)", cfg.archive_retention_days)
        if cfg.archive_retention_days > 0:
            archive_dir = cfg.data_dir / "archive"
            deleted = cleanup_archive(archive_dir, cfg.archive_retention_days)
            if deleted:
                log.info("Démarrage — %d archive(s) expirée(s) supprimée(s).", len(deleted))
    except RuntimeError as exc:
        log.error("Configuration invalide : %s", exc)
    yield


app = FastAPI(
    title="Pipeline Numérisation Cabinet",
    description="API locale — numérisation nLPD des fiches patients manuscrites",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=_lifespan,
)

# CORS — autorise uniquement le dashboard local (Vite dev + dist file://)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "null",  # ouverture directe depuis dist/index.html
    ],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Vérifie que le service est opérationnel et que la config est valide."""
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return HealthResponse(
        status="ok",
        downloads_folder=str(cfg.downloads_folder),
        data_dir=str(cfg.data_dir),
        archive_retention_days=cfg.archive_retention_days,
    )


@app.get("/pipeline/scan", response_model=ScanResponse)
def pipeline_scan() -> ScanResponse:
    """
    Scanne le dossier Téléchargements et retourne les photos détectées
    sans déclencher de traitement.

    Utile pour vérifier ce qui sera traité avant de lancer /pipeline/run.
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not cfg.downloads_folder.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Dossier introuvable : {cfg.downloads_folder}",
        )

    result = watcher_scan(
        folder=cfg.downloads_folder,
        max_age_days=cfg.max_age_days,
        min_age_seconds=cfg.min_age_seconds,
    )

    return ScanResponse(
        batches=[
            BatchInfo(
                prenom_nom=b.prenom_nom,
                pages=len(b.files),
                files=[f.name for f in b.files],
            )
            for b in result.batches
        ],
        too_recent=[p.name for p in result.too_recent],
        too_old=[p.name for p in result.too_old],
        ignored_count=len(result.ignored),
    )


@app.post("/pipeline/run", response_model=RunResponse)
def pipeline_run() -> RunResponse:
    """
    Lance le pipeline complet sur les photos détectées dans Téléchargements.

    Nécessite ANTHROPIC_API_KEY et PIPELINE_PASSWORD.

    Pour chaque fiche :
    - Compression → extraction OCR (Claude Vision) → pseudonymisation
    - Génération docx chiffré + docx anonymisé
    - Suppression ou archivage des photos sources (selon PIPELINE_ARCHIVE_RETENTION_DAYS)
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not cfg.api_key:
        raise HTTPException(
            status_code=500,
            detail="Variable d'environnement ANTHROPIC_API_KEY manquante.",
        )

    if not cfg.downloads_folder.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Dossier introuvable : {cfg.downloads_folder}",
        )

    try:
        result = run(cfg)
    except Exception as exc:
        log.exception("Erreur pipeline")
        raise HTTPException(status_code=500, detail=str(exc))

    return RunResponse(
        processed=[
            BatchResultResponse(
                prenom_nom=b.prenom_nom,
                code=b.code,
                code_created=b.code_created,
                photos_archived=len(b.photos_archived),
                photos_deleted=len(b.photos_deleted),
            )
            for b in result.processed
        ],
        errors=[
            {"prenom_nom": name, "error": str(exc)}
            for name, exc in result.errors
        ],
        scan_summary={
            "batches_detected": len(result.scan.batches),
            "too_recent": len(result.scan.too_recent),
            "too_old": len(result.scan.too_old),
            "ignored": len(result.scan.ignored),
        },
    )


@app.get("/archive/status", response_model=ArchiveStatusResponse)
def archive_status() -> ArchiveStatusResponse:
    """
    Liste les photos en attente de suppression dans data/archive/.
    Indique l'âge de chaque fichier pour anticiper la prochaine purge nLPD.
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    archive_dir = cfg.data_dir / "archive"
    if not archive_dir.exists():
        return ArchiveStatusResponse(
            total_files=0,
            retention_days=cfg.archive_retention_days,
            files=[],
        )

    now = time.time()
    files = [
        ArchiveFile(
            name=p.name,
            age_days=round((now - p.stat().st_mtime) / 86400, 1),
        )
        for p in sorted(archive_dir.iterdir())
        if p.is_file()
    ]

    return ArchiveStatusResponse(
        total_files=len(files),
        retention_days=cfg.archive_retention_days,
        files=files,
    )


@app.post("/archive/cleanup", response_model=CleanupResponse)
def archive_cleanup() -> CleanupResponse:
    """
    Purge nLPD — supprime de manière sécurisée les photos archivées
    dont l'âge dépasse PIPELINE_ARCHIVE_RETENTION_DAYS.

    Appelé automatiquement au démarrage du serveur.
    Peut être déclenché manuellement à tout moment.
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if cfg.archive_retention_days == 0:
        return CleanupResponse(
            deleted_count=0,
            deleted_files=[],
        )

    archive_dir = cfg.data_dir / "archive"
    deleted = cleanup_archive(archive_dir, cfg.archive_retention_days)

    return CleanupResponse(
        deleted_count=len(deleted),
        deleted_files=[p.name for p in deleted],
    )


# ---------------------------------------------------------------------------
# Endpoints /api/* — storage chiffré, corpus IEATC, proxy Claude
# Reproduit le comportement du plugin Vite (vite-plugin-storage.ts)
# pour que le dashboard fonctionne depuis uvicorn sans Vite.
# ---------------------------------------------------------------------------

_CABINET_DATA = Path(__file__).resolve().parent.parent.parent / "cabinet-acupuncture" / "data"
_CORPUS_DIR   = Path(__file__).resolve().parent.parent.parent / "Corpus IEATC"


@app.get("/api/storage")
def api_storage_get():
    """Lit le fichier chiffré des dossiers patients."""
    enc = _CABINET_DATA / "cabinet-data.enc"
    if not enc.exists():
        return {"exists": False}
    return {"exists": True, "data": enc.read_text("utf-8")}


@app.post("/api/storage")
async def api_storage_post(request: Request):
    """Écrit le fichier chiffré des dossiers patients."""
    body = await request.json()
    _CABINET_DATA.mkdir(parents=True, exist_ok=True)
    (_CABINET_DATA / "cabinet-data.enc").write_text(body["data"], "utf-8")
    return {"ok": True}


@app.get("/api/salt")
def api_salt_get():
    """Lit le sel de dérivation de clé."""
    salt_file = _CABINET_DATA / "cabinet-data.salt"
    if not salt_file.exists():
        return {"exists": False}
    return {"exists": True, "salt": salt_file.read_text("utf-8")}


@app.post("/api/salt")
async def api_salt_post(request: Request):
    """Écrit le sel de dérivation de clé."""
    body = await request.json()
    _CABINET_DATA.mkdir(parents=True, exist_ok=True)
    (_CABINET_DATA / "cabinet-data.salt").write_text(body["salt"], "utf-8")
    return {"ok": True}


@app.get("/api/corpus")
def api_corpus_get(sections: str = ""):
    """Charge les fichiers YAML du corpus IEATC."""
    corpus: dict[str, str] = {}
    for section in (s.strip() for s in sections.split(",") if s.strip()):
        section_path = _CORPUS_DIR / section
        if section_path.exists():
            for f in sorted(section_path.iterdir()):
                if f.suffix == ".yaml":
                    corpus[f"{section}/{f.name}"] = f.read_text("utf-8")

    philosophie = ""
    p = _CORPUS_DIR / "_SYSTEME" / "00_philosophie_clinique.yaml"
    if p.exists():
        philosophie = p.read_text("utf-8")

    arbres = ""
    a = _CORPUS_DIR / "_SYSTEME" / "00_arbres_decision.yaml"
    if a.exists():
        arbres = a.read_text("utf-8")

    return {"corpus": corpus, "philosophie": philosophie, "arbres": arbres}


# ---------------------------------------------------------------------------
# Endpoints /patients/* — accès aux fiches générées par le pipeline
# ---------------------------------------------------------------------------

@app.get("/api/patients")
def list_patients():
    """
    Liste tous les patients traités par le pipeline.
    Source : mapping.enc + présence des fichiers docx/json.
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    mapping_path = cfg.data_dir / "mapping.enc"
    if not mapping_path.exists():
        return []

    mapping = load_mapping(mapping_path, cfg.password)
    normal_dir = cfg.data_dir / "normal"
    json_dir = cfg.data_dir / "json"

    result = []
    for code, identity in sorted(mapping.items()):
        docx_files = list(normal_dir.glob(f"*_{code}.docx")) if normal_dir.exists() else []
        has_json = (json_dir / f"{code}.json").exists() if json_dir.exists() else False
        result.append({
            "code": code,
            "prenom_nom": identity.get("prenom_nom", code),
            "date_naissance": identity.get("date_naissance"),
            "has_docx": len(docx_files) > 0,
            "has_json": has_json,
        })

    return result


@app.get("/api/patients/{code}/docx")
def get_patient_docx(code: str):
    """Télécharge le docx déchiffré du patient (en mémoire — jamais en clair sur disque)."""
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    normal_dir = cfg.data_dir / "normal"
    matches = list(normal_dir.glob(f"*_{code}.docx")) if normal_dir.exists() else []
    if not matches:
        raise HTTPException(status_code=404, detail=f"Aucun docx trouvé pour {code}")

    docx_path = matches[0]
    try:
        plaintext = decrypt_bytes(docx_path.read_bytes(), cfg.password)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content=plaintext,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={code}.docx"},
    )


@app.get("/api/patients/{code}/odt")
def get_patient_odt(code: str):
    """Télécharge le ODT déchiffré du patient (LibreOffice — jamais en clair sur disque)."""
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    normal_dir = cfg.data_dir / "normal"
    matches = list(normal_dir.glob(f"*_{code}.odt")) if normal_dir.exists() else []
    if not matches:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun ODT trouvé pour {code}. Relancez le pipeline pour générer les ODT.",
        )

    odt_path = matches[0]
    try:
        plaintext = decrypt_bytes(odt_path.read_bytes(), cfg.password)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content=plaintext,
        media_type="application/vnd.oasis.opendocument.text",
        headers={"Content-Disposition": f"attachment; filename={code}.odt"},
    )


@app.get("/api/patients/{code}/json")
def get_patient_json(code: str):
    """Retourne le JSON déchiffré du patient (données brutes extraites par le pipeline)."""
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    json_path = cfg.data_dir / "json" / f"{code}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail=f"Aucun JSON trouvé pour {code}. Ce patient a été traité avant la mise à jour du pipeline.")

    try:
        data = decrypt_json_from_file(json_path, cfg.password)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return data


@app.delete("/pipeline/batch")
def pipeline_delete_batch(prenom_nom: str):
    """
    Supprime de maniere securisee toutes les photos d'un patient
    dans le dossier Telechargements (avant traitement).
    Utilise le meme mecanisme que cleanup_archive (ecrasement + unlink).
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    from .photo_watcher import _parse_stem, SUPPORTED_EXTENSIONS
    from .pipeline_patient import _secure_delete

    deleted: list[str] = []
    errors: list[str] = []

    for path in cfg.downloads_folder.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        parsed = _parse_stem(path.stem)
        if parsed is None:
            continue
        name, _ = parsed
        if name == prenom_nom:
            try:
                _secure_delete(path)
                deleted.append(path.name)
            except Exception as exc:
                errors.append(f"{path.name}: {exc}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return {"deleted": deleted}


@app.post("/api/claude")
async def api_claude_post(request: Request):
    """Proxy vers l'API Anthropic (évite d'exposer la clé côté navigateur)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY manquant dans config.env")

    body = await request.json()

    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=body,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
        )

    return JSONResponse(content=r.json(), status_code=r.status_code)


# ---------------------------------------------------------------------------
# Régénération depuis le dashboard (sans IA)
# ---------------------------------------------------------------------------

def _dashboard_to_pipeline_dict(patient: dict) -> dict:
    """
    Convertit un dossier patient du dashboard (format TypeScript Patient)
    en dict pipeline compatible avec build_docx/save_normal/save_anonymized.
    Aucune IA requise — reconstruction pure depuis les données structurées.
    """
    prenom = patient.get("prenom", "")
    nom = patient.get("nom", "")
    prenom_nom = f"{prenom} {nom}".strip()

    sorted_sessions = sorted(
        patient.get("sessions", []),
        key=lambda s: s.get("date", ""),
    )
    pipeline_sessions = []
    for i, s in enumerate(sorted_sessions):
        points = []
        for pt in s.get("pointsNeedled", []):
            if isinstance(pt, str):
                points.append(pt)
            else:
                points.append({"code": pt.get("code", ""), "technique": pt.get("technique")})
        pipeline_sessions.append({
            "numero": i + 1,
            "date": s["date"][:10] if s.get("date") else None,
            "remarques": s.get("remarques") or None,
            "pouls_langue": s.get("poulsLangue") or None,
            "strategie": s.get("strategie") or None,
            "points_utilises": points,
            "amelioration": s.get("amelioration"),
            "a_faire_prochaine_seance": s.get("aFaireProchaineSéance") or None,
        })

    notes = [n["note"] for n in patient.get("notesAnamnese", []) if n.get("note")]

    return {
        "identite": {
            "prenom_nom": prenom_nom,
            "date_naissance": patient.get("dateNaissance") or None,
            "profession": None,
            "enfants": None,
            "telephone": patient.get("telephone") or None,
            "mail": patient.get("email") or None,
            "adresse": patient.get("adresse") or None,
            "canal_communication": None,
        },
        "motif_consultation": patient.get("anamnese") or None,
        "symptome": None,
        "histoire_personnelle": patient.get("constitution") or None,
        "antecedents_personnels_familiaux": None,
        "traitements_en_cours": None,
        "stress_fatigue_psychique": None,
        "systeme_digestif": None,
        "sommeil": None,
        "cardio_vasculaire": None,
        "cycle_menstruel": None,
        "pouls_langue": None,
        "notes_en_cours_de_suivi": notes,
        "seances": pipeline_sessions,
    }


@app.post("/api/patients/{code}/regenerate")
async def regenerate_patient(code: str, request: Request):
    """
    Régénère les fiches DOCX/ODT d'un patient depuis les données du dashboard.
    Sans IA — reconstruction pure depuis les données structurées.
    • Fiche normale : rechiffrée AES-256 dans data/normal/
    • Fiche anonymisée : reconstruite en clair dans data/anonymized/
    Corps JSON : { "patient": <Patient dashboard JSON> }
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    mapping_path = cfg.data_dir / "mapping.enc"
    if not mapping_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Mapping introuvable. Lancez d'abord le pipeline sur des photos.",
        )

    mapping = load_mapping(mapping_path, cfg.password)
    if code not in mapping:
        raise HTTPException(status_code=404, detail=f"Code {code} inconnu dans le mapping.")

    body = await request.json()
    patient = body.get("patient", {})

    pipeline_dict = _dashboard_to_pipeline_dict(patient)
    # Préserve le nom stocké dans le mapping (peut contenir le suffixe Tailscale original)
    pipeline_dict["identite"]["prenom_nom"] = mapping[code].get(
        "prenom_nom", pipeline_dict["identite"]["prenom_nom"]
    )

    normal_dir = cfg.data_dir / "normal"
    anon_dir = cfg.data_dir / "anonymized"
    normal_dir.mkdir(parents=True, exist_ok=True)
    anon_dir.mkdir(parents=True, exist_ok=True)

    # Supprime les anciennes versions de ce patient avant régénération
    for old in (
        list(normal_dir.glob(f"*_{code}.docx"))
        + list(normal_dir.glob(f"*_{code}.odt"))
    ):
        old.unlink(missing_ok=True)

    try:
        save_normal(pipeline_dict, code, normal_dir, cfg.password)
        anon_dict = anonymize(pipeline_dict, code)
        save_anonymized(anon_dict, code, anon_dir)
    except Exception as exc:
        log.exception("Erreur régénération %s", code)
        raise HTTPException(status_code=500, detail=str(exc))

    log.info("Fiches régénérées depuis dashboard : %s", code)
    return {"ok": True, "code": code}


_SOFFICE = Path("C:/Program Files/LibreOffice/program/soffice.exe")
_TEMP_DIR = Path(tempfile.gettempdir()) / "cabinet_acupuncture"


@app.post("/api/patients/{code}/open-odt")
def open_patient_odt(code: str):
    """
    Déchiffre la fiche ODT du patient et l'ouvre dans LibreOffice.
    Le fichier temporaire est écrasé à chaque appel (jamais stocké durablement en clair).
    """
    try:
        cfg = _config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not _SOFFICE.exists():
        raise HTTPException(status_code=500, detail="LibreOffice introuvable sur ce poste.")

    normal_dir = cfg.data_dir / "normal"
    matches = list(normal_dir.glob(f"*_{code}.odt")) if normal_dir.exists() else []
    if not matches:
        raise HTTPException(
            status_code=404,
            detail="Fiche ODT introuvable. Modifiez le dossier patient pour déclencher la génération automatique.",
        )

    odt_path = matches[0]
    try:
        plaintext = decrypt_bytes(odt_path.read_bytes(), cfg.password)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    _TEMP_DIR.mkdir(parents=True, exist_ok=True)
    tmp_odt = _TEMP_DIR / f"{code}.odt"
    tmp_odt.write_bytes(plaintext)

    subprocess.Popen([str(_SOFFICE), str(tmp_odt)])
    log.info("Fiche ODT ouverte dans LibreOffice : %s", code)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Serving du dashboard React (dist/)
# Doit être en DERNIER — le catch-all SPA écrase toute route non trouvée.
# ---------------------------------------------------------------------------

_DIST = Path(__file__).resolve().parent.parent.parent / "cabinet-acupuncture" / "dist"

if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    def _favicon():
        return FileResponse(_DIST / "favicon.svg")

    @app.get("/icons.svg", include_in_schema=False)
    def _icons():
        return FileResponse(_DIST / "icons.svg")

    # Catch-all SPA — toutes les routes React (/, /patients, /numerisation…)
    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa(full_path: str):
        return FileResponse(_DIST / "index.html")

else:
    log.warning(
        "Dossier dist/ introuvable (%s). "
        "Lancer 'npm run build' dans cabinet-acupuncture/ pour générer le dashboard.",
        _DIST,
    )

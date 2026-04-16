"""
Pipeline patient — orchestre le traitement complet d'un lot de photos.

Flux par batch (un batch = toutes les photos d'un même patient) :
    photos Downloads → compress → vision extract → pseudonymize
    → docx normal (chiffré) + docx anonymisé (en clair)
    → gestion nLPD des photos sources → mise à jour mapping.enc

Gestion nLPD des photos sources :
    archive_retention_days = 0   → suppression sécurisée immédiate après traitement
    archive_retention_days = N   → déplacement dans data/archive/, purge après N jours
                                   (appeler cleanup_archive() régulièrement)

Usage :
    from pathlib import Path
    from backend.pipeline_patient import PipelineConfig, run, cleanup_archive

    result = run(PipelineConfig(
        downloads_folder=Path.home() / "Downloads",
        data_dir=Path("pipeline/data"),
        password="mot_de_passe_fort",
        api_key="sk-ant-...",
        archive_retention_days=30,
    ))

    deleted = cleanup_archive(Path("pipeline/data/archive"), retention_days=30)
"""
from __future__ import annotations

import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

from .compressor import compress_many
from .crypto import encrypt_json_to_file
from .docx_generator import save_anonymized, save_normal
from .photo_watcher import PhotoBatch, ScanResult, scan
from .pseudonymizer import anonymize, get_or_create_code, load_mapping, save_mapping
from .vision_extractor import extract

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class PipelineConfig:
    """Paramètres du pipeline. Passer une instance à run()."""

    downloads_folder: Path              # Dossier Téléchargements (source Tailscale)
    data_dir: Path                      # Racine data/ (normal/, anonymized/, archive/)
    password: str                       # Mot de passe AES-256 pour chiffrement
    api_key: str | None = None          # Clé Anthropic (None = lit ANTHROPIC_API_KEY)
    max_age_days: int = 7               # Photos plus vieilles → ignorées avec avertissement
    min_age_seconds: int = 30           # Photos trop récentes → transfert peut-être en cours
    archive_retention_days: int = 30    # 0 = suppression immédiate après traitement (nLPD strict)


# ---------------------------------------------------------------------------
# Résultats
# ---------------------------------------------------------------------------

@dataclass
class BatchResult:
    """Résultat du traitement d'un patient."""

    prenom_nom: str
    code: str                              # ex: P0003
    code_created: bool                     # True si nouveau patient
    normal_docx: Path                      # Chemin docx chiffré
    anon_docx: Path                        # Chemin docx pseudonymisé
    photos_archived: list[Path] = field(default_factory=list)   # rétention > 0
    photos_deleted: list[Path] = field(default_factory=list)    # rétention = 0


@dataclass
class PipelineResult:
    """Résultat global du pipeline."""

    scan: ScanResult
    processed: list[BatchResult] = field(default_factory=list)
    errors: list[tuple[str, Exception]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Suppression sécurisée (nLPD)
# ---------------------------------------------------------------------------

def _secure_delete(path: Path) -> None:
    """
    Écrase le fichier avec des zéros puis le supprime.

    Note : sur SSD, l'écrasement ne garantit pas l'effacement physique des secteurs
    (wear leveling). Pour une sécurité maximale, utiliser un disque chiffré (BitLocker).
    Cela reste conforme nLPD pour un usage local sur machine maîtrisée.
    """
    size = path.stat().st_size
    with open(path, "r+b") as f:
        f.write(b"\x00" * size)
        f.flush()
        os.fsync(f.fileno())
    path.unlink()
    log.debug("Supprimé (nLPD) : %s", path.name)


# ---------------------------------------------------------------------------
# Nettoyage des archives expirées
# ---------------------------------------------------------------------------

def cleanup_archive(
    archive_dir: Path,
    retention_days: int,
    _now: float | None = None,
) -> list[Path]:
    """
    Supprime de manière sécurisée les photos archivées plus vieilles que retention_days.

    À appeler périodiquement (ex : au démarrage du serveur FastAPI, ou via cron).

    Parameters
    ----------
    archive_dir       Répertoire data/archive/
    retention_days    Durée de conservation en jours
    _now              Timestamp de référence (test uniquement)

    Returns
    -------
    Liste des fichiers supprimés.
    """
    if not archive_dir.exists():
        return []

    now = _now if _now is not None else time.time()
    limit = retention_days * 86400
    deleted: list[Path] = []

    for path in archive_dir.iterdir():
        if not path.is_file():
            continue
        age = now - path.stat().st_mtime
        if age > limit:
            try:
                _secure_delete(path)
                deleted.append(path)
            except Exception as exc:
                log.error("Impossible de supprimer %s : %s", path.name, exc)

    if deleted:
        log.info(
            "nLPD — %d photo(s) archivée(s) supprimée(s) (> %d jour(s)).",
            len(deleted),
            retention_days,
        )
    return deleted


# ---------------------------------------------------------------------------
# Traitement d'un batch
# ---------------------------------------------------------------------------

def _process_batch(
    batch: PhotoBatch,
    mapping: dict,
    config: PipelineConfig,
    normal_dir: Path,
    anon_dir: Path,
    archive_dir: Path,
    json_dir: Path,
) -> BatchResult:
    """Traite toutes les photos d'un patient et produit les deux docx."""
    log.info("Traitement : %s (%d photo(s))", batch.prenom_nom, len(batch.files))

    # 1. Compression (redimensionne ≤ 1280×960, JPEG 80)
    compressed = compress_many(batch.files)

    # 2. Extraction vision via Claude
    patient_data = extract(compressed, api_key=config.api_key)

    # Le nom du fichier fait foi : on écrase ce que l'OCR a pu lire
    if patient_data.get("identite") is None:
        patient_data["identite"] = {}
    patient_data["identite"]["prenom_nom"] = batch.prenom_nom

    # 3. Code patient (crée si inconnu du mapping)
    code, created = get_or_create_code(
        prenom_nom=batch.prenom_nom,
        identity_data=patient_data.get("identite", {}),
        mapping=mapping,
    )
    log.info("Code : %s (%s)", code, "nouveau" if created else "existant")

    # 4. JSON chiffré (données brutes pour import dashboard + statistiques)
    json_dir.mkdir(parents=True, exist_ok=True)
    json_path = json_dir / f"{code}.json"
    encrypt_json_to_file(patient_data, json_path, config.password)
    log.info("JSON chiffré : %s", json_path.name)

    # 5. Docx complet chiffré (identité en clair, stocké localement)
    normal_path = save_normal(patient_data, code, normal_dir, config.password)
    log.info("Docx normal : %s", normal_path.name)

    # 6. Docx pseudonymisé en clair (pour l'assistant IA)
    patient_anon = anonymize(patient_data, code)
    anon_path = save_anonymized(patient_anon, code, anon_dir)
    log.info("Docx anonymisé : %s", anon_path.name)

    # 7. Gestion nLPD des photos sources (docx générés = données canoniques)
    archived: list[Path] = []
    deleted: list[Path] = []

    if config.archive_retention_days == 0:
        # Suppression immédiate — aucune photo ne subsiste sur disque
        for src in batch.files:
            _secure_delete(src)
            deleted.append(src)
        log.info("nLPD — %d photo(s) supprimée(s) immédiatement.", len(deleted))
    else:
        # Archivage temporaire — nettoyage différé via cleanup_archive()
        archive_dir.mkdir(parents=True, exist_ok=True)
        for src in batch.files:
            dst = archive_dir / src.name
            shutil.move(str(src), dst)
            archived.append(dst)
        log.info(
            "Archivé (%d j max) : %d photo(s).",
            config.archive_retention_days,
            len(archived),
        )

    return BatchResult(
        prenom_nom=batch.prenom_nom,
        code=code,
        code_created=created,
        normal_docx=normal_path,
        anon_docx=anon_path,
        photos_archived=archived,
        photos_deleted=deleted,
    )


# ---------------------------------------------------------------------------
# Point d'entrée principal
# ---------------------------------------------------------------------------

def run(config: PipelineConfig) -> PipelineResult:
    """
    Lance le pipeline complet.

    Étapes :
        1. Scan du dossier Téléchargements (photo_watcher)
        2. Avertissements pour photos trop récentes / trop anciennes
        3. Traitement de chaque batch patient
        4. Sauvegarde du mapping.enc mis à jour (une seule écriture à la fin)

    Returns
    -------
    PipelineResult avec tous les détails (processed, errors, scan).
    """
    normal_dir = config.data_dir / "normal"
    anon_dir = config.data_dir / "anonymized"
    archive_dir = config.data_dir / "archive"
    json_dir = config.data_dir / "json"
    mapping_path = config.data_dir / "mapping.enc"

    normal_dir.mkdir(parents=True, exist_ok=True)
    anon_dir.mkdir(parents=True, exist_ok=True)

    # — Scan —
    scan_result = scan(
        folder=config.downloads_folder,
        max_age_days=config.max_age_days,
        min_age_seconds=config.min_age_seconds,
    )

    if scan_result.too_recent:
        log.warning(
            "%d photo(s) ignorée(s) — transfert Tailscale peut-être en cours : %s",
            len(scan_result.too_recent),
            [p.name for p in scan_result.too_recent],
        )

    if scan_result.too_old:
        log.warning(
            "%d photo(s) ignorée(s) — plus vieilles que %d jour(s) : %s",
            len(scan_result.too_old),
            config.max_age_days,
            [p.name for p in scan_result.too_old],
        )

    if not scan_result.batches:
        log.info("Aucune fiche à traiter dans %s.", config.downloads_folder)
        return PipelineResult(scan=scan_result)

    log.info("%d batch(es) détecté(s).", len(scan_result.batches))

    # — Chargement mapping (déchiffré en mémoire) —
    mapping = load_mapping(mapping_path, config.password)

    pipeline_result = PipelineResult(scan=scan_result)

    for batch in scan_result.batches:
        try:
            batch_result = _process_batch(
                batch=batch,
                mapping=mapping,
                config=config,
                normal_dir=normal_dir,
                anon_dir=anon_dir,
                archive_dir=archive_dir,
                json_dir=json_dir,
            )
            pipeline_result.processed.append(batch_result)
        except Exception as exc:
            log.error("Erreur sur '%s' : %s", batch.prenom_nom, exc, exc_info=True)
            pipeline_result.errors.append((batch.prenom_nom, exc))

    # — Sauvegarde mapping une seule fois à la fin —
    if pipeline_result.processed:
        save_mapping(mapping, mapping_path, config.password)
        log.info(
            "Mapping sauvegardé — %d patient(s) au total.",
            len(mapping),
        )

    return pipeline_result

"""
Photo watcher — détecte et groupe les photos de fiches patients
dans le dossier Téléchargements (arrivée via Tailscale).

Convention de nommage attendue :
    Prénom Nom.jpg             → fiche page 1
    Prénom Nom 2.jpg           → fiche page 2
    Prénom Nom 3.jpg           → fiche page 3

Garde-fous appliqués dans l'ordre :
    1. Extension non supportée              → ignored
    2. Taille < min_size_kb                 → ignored  (fichier tronqué)
    3. Âge < min_age_seconds                → too_recent  (transfert en cours)
    4. Âge > max_age_days                   → too_old     (fiche périmée)
    5. Nom sans espace (pas "Prénom Nom")   → ignored
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}

DEFAULT_MIN_AGE_SECONDS: int = 30
DEFAULT_MAX_AGE_DAYS: int = 7
DEFAULT_MIN_SIZE_KB: int = 10


@dataclass
class PhotoBatch:
    """Groupe de photos d'un même patient, triées par numéro de page."""

    prenom_nom: str
    files: list[Path]  # triés par numéro de page croissant


@dataclass
class ScanResult:
    """Résultat complet d'un scan du dossier Téléchargements."""

    batches: list[PhotoBatch] = field(default_factory=list)
    too_recent: list[Path] = field(default_factory=list)  # transfert Tailscale en cours
    too_old: list[Path] = field(default_factory=list)      # > max_age_days
    ignored: list[Path] = field(default_factory=list)      # extension/nom/taille invalide


# ---------------------------------------------------------------------------
# Parsing du nom de fichier
# ---------------------------------------------------------------------------

def _parse_stem(stem: str) -> tuple[str, int] | None:
    """
    Extrait (prenom_nom, page) depuis le nom de fichier sans extension.

    Accepte :
        'Marie Dupont'         → ('Marie Dupont', 1)
        'Marie Dupont 2'       → ('Marie Dupont', 2)
        'Marie Dupont_2'       → ('Marie Dupont', 2)   # underscore Tailscale/iOS
        'Jean-Pierre Martin 3' → ('Jean-Pierre Martin', 3)
        'Marie Anne Dupont'    → ('Marie Anne Dupont', 1)

    Rejette (retourne None) :
        'IMG_1234'             → pas d'espace dans le nom
        'Rapport'              → pas d'espace
        'Screenshot_20240101'  → pas d'espace
    """
    stem = stem.strip()

    # Nombre terminal séparé par espace ou underscore → numéro de page
    m = re.match(r"^(.+?)[\s_]+(\d+)$", stem)
    if m:
        name_part = m.group(1).strip()
        page = int(m.group(2))
    else:
        name_part = stem
        page = 1

    # Prénom Nom minimum = au moins un espace
    if " " not in name_part:
        return None

    return name_part, page


# ---------------------------------------------------------------------------
# Scan principal
# ---------------------------------------------------------------------------

def scan(
    folder: Path,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    min_age_seconds: int = DEFAULT_MIN_AGE_SECONDS,
    min_size_kb: int = DEFAULT_MIN_SIZE_KB,
    _now: float | None = None,
) -> ScanResult:
    """
    Scanne *folder* et regroupe les photos de fiches patients.

    Parameters
    ----------
    folder            Répertoire à scanner (typiquement ~/Downloads)
    max_age_days      Photos plus vieilles que N jours → too_old  (défaut 7)
    min_age_seconds   Photos plus récentes que N secondes → too_recent (défaut 30)
    min_size_kb       Taille minimale en Ko → ignored si en dessous (défaut 10)
    _now              Timestamp de référence (injecté en test uniquement)

    Returns
    -------
    ScanResult avec les batches prêts à traiter + listes de fichiers problématiques.
    """
    now = _now if _now is not None else time.time()
    result = ScanResult()
    groups: dict[str, list[tuple[int, Path]]] = {}

    for path in sorted(folder.iterdir()):
        if not path.is_file():
            continue

        # 1. Extension
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            result.ignored.append(path)
            continue

        stat = path.stat()

        # 2. Taille minimale (évite les fichiers tronqués / corrompus)
        if stat.st_size < min_size_kb * 1024:
            result.ignored.append(path)
            continue

        age_seconds = now - stat.st_mtime

        # 3. Trop récent → transfert Tailscale probablement en cours
        if age_seconds < min_age_seconds:
            result.too_recent.append(path)
            continue

        # 4. Trop ancien → fiche périmée, ne pas traiter
        if age_seconds > max_age_days * 86400:
            result.too_old.append(path)
            continue

        # 5. Nom valide (Prénom Nom obligatoire)
        parsed = _parse_stem(path.stem)
        if parsed is None:
            result.ignored.append(path)
            continue

        prenom_nom, page = parsed
        groups.setdefault(prenom_nom, []).append((page, path))

    # Construit les batches triés par numéro de page
    for prenom_nom, pages in sorted(groups.items()):
        pages.sort(key=lambda x: x[0])
        result.batches.append(PhotoBatch(
            prenom_nom=prenom_nom,
            files=[p for _, p in pages],
        ))

    return result

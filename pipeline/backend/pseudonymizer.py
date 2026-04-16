"""
Pseudonymizer — gestion de la table mapping.enc et anonymisation des dossiers.

Mapping en mémoire :
  { "P0001": {"prenom_nom": "Marie Dupont", "date_naissance": ..., ...}, ... }

Sur disque : mapping.enc chiffré via crypto.py (AES-256-GCM).
Aucune donnée identifiante n'est écrite en clair sur disque.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

from .crypto import decrypt_json_from_file, encrypt_json_to_file

# Tous les champs de la section "identite" sont considérés identifiants
IDENTITY_KEYS = [
    "prenom_nom",
    "date_naissance",
    "profession",
    "enfants",
    "telephone",
    "mail",
    "adresse",
    "canal_communication",
]

CODE_PREFIX = "P"
CODE_WIDTH = 4  # P0001 … P9999


# ---------------------------------------------------------------------------
# Normalisation du nom (artefacts Tailscale)
# ---------------------------------------------------------------------------

def normalize_name(prenom_nom: str) -> str:
    """
    Retire le suffixe numérique Tailscale d'un nom de patient.
    Ex : "Bernard Hofmann_10" → "Bernard Hofmann"
         "Nicole Chalet_2"   → "Nicole Chalet"
    """
    return re.sub(r"_\d+$", "", prenom_nom.strip()).strip()


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------

def _fmt(n: int) -> str:
    return f"{CODE_PREFIX}{n:0{CODE_WIDTH}d}"


def _codes(mapping: dict) -> list[int]:
    return [
        int(k[len(CODE_PREFIX):])
        for k in mapping
        if k.startswith(CODE_PREFIX) and k[len(CODE_PREFIX):].isdigit()
    ]


# ---------------------------------------------------------------------------
# Mapping — chargement / sauvegarde
# ---------------------------------------------------------------------------

def load_mapping(path: Path, password: str) -> dict:
    """Charge le mapping depuis mapping.enc. Retourne {} si le fichier n'existe pas."""
    if not path.exists():
        return {}
    return decrypt_json_from_file(path, password)


def save_mapping(mapping: dict, path: Path, password: str) -> None:
    """Chiffre et écrit le mapping sur disque."""
    encrypt_json_to_file(mapping, path, password)


# ---------------------------------------------------------------------------
# Codes patients
# ---------------------------------------------------------------------------

def next_code(mapping: dict) -> str:
    """Retourne le prochain code disponible (P0001 si vide)."""
    nums = _codes(mapping)
    return _fmt(max(nums) + 1) if nums else _fmt(1)


def find_code(prenom_nom: str, mapping: dict) -> str | None:
    """
    Recherche un code par prenom_nom, insensible à la casse et au suffixe _N.
    Ex : "Bernard Hofmann_10" trouve "Bernard Hofmann".
    """
    needle = normalize_name(prenom_nom).lower()
    for code, identity in mapping.items():
        stored = normalize_name(identity.get("prenom_nom", "")).lower()
        if stored == needle:
            return code
    return None


def get_or_create_code(
    prenom_nom: str,
    identity_data: dict,
    mapping: dict,
) -> tuple[str, bool]:
    """
    Retourne (code, created).

    - Si prenom_nom existe dans mapping (après normalisation) → (code_existant, False).
    - Sinon crée une nouvelle entrée avec le nom propre (sans suffixe _N).
    - mapping est muté en place ; appeler save_mapping() ensuite.
    """
    existing = find_code(prenom_nom, mapping)
    if existing:
        return existing, False
    code = next_code(mapping)
    clean = normalize_name(prenom_nom)
    mapping[code] = {**identity_data, "prenom_nom": clean}
    return code, True


# ---------------------------------------------------------------------------
# Anonymisation
# ---------------------------------------------------------------------------

def anonymize(patient: dict, code: str) -> dict:
    """
    Retourne une copie profonde du dossier où chaque champ non-null
    de la section « identite » est remplacé par le code patient.
    Les champs null restent null.
    """
    anon = copy.deepcopy(patient)
    identite = anon.get("identite")
    if isinstance(identite, dict):
        for key in list(identite.keys()):
            if identite[key] is not None:
                identite[key] = code
    return anon

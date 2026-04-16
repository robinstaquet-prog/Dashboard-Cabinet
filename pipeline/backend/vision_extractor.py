"""
Vision extractor — transcrit des fiches patients manuscrites
via l'API Anthropic (Claude Vision).

Pré-requis : variable d'environnement ANTHROPIC_API_KEY.
Les images doivent déjà être compressées (max 1280×960, JPEG 80).
"""
from __future__ import annotations

import base64
import json
import os
import re

import anthropic

MODEL = "claude-opus-4-6"

# Schéma vide — sert de gabarit dans le prompt
_SCHEMA: dict = {
    "date_premiere_seance": None,
    "identite": {
        "prenom_nom": None,
        "date_naissance": None,
        "profession": None,
        "enfants": None,
        "telephone": None,
        "mail": None,
        "adresse": None,
        "canal_communication": None,
    },
    "motif_consultation": None,
    "motifs_normalises": [],   # liste normalisée des problèmes principaux
    "symptome": {
        "manifestation": None,
        "depuis": None,
        "aggravation_amelioration": None,
    },
    "histoire_personnelle": None,
    "antecedents_personnels_familiaux": None,
    "traitements_en_cours": None,
    "stress_fatigue_psychique": None,
    "systeme_digestif": None,
    "sommeil": None,
    "cardio_vasculaire": {"observations": None, "anticoagulants": None},
    "cycle_menstruel": None,
    "pouls_langue": None,
    "notes_en_cours_de_suivi": [],
    "seances": [
        {
            "numero": i,
            "date": None,
            "remarques": None,
            "pouls_langue": None,
            "strategie": None,
            "points_utilises": [],
            "amelioration": None,
            "a_faire_prochaine_seance": None,
        }
        for i in range(1, 13)
    ],
}

_SYSTEM = """\
Tu es un assistant spécialisé dans la transcription de fiches patients \
manuscrites pour un cabinet d'acupuncture en Suisse.

Tu reçois une ou plusieurs photos d'une fiche patient \
(questionnaire initial + notes de séances).
Retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après.

Règles générales :
- Champ absent ou illisible → null.
- Transcris exactement ce qui est écrit, sans corriger ni interpréter.

Motifs normalisés (motifs_normalises) :
À partir du motif de consultation et des symptômes décrits, extrais la liste des \
problèmes de santé principaux sous forme courte et normalisée.
Ne garde que les problèmes cliniques réels — pas les contextes de vie ni les détails.
Exemples :
  "Douleurs articulaires, poignet gauche, sensible au climat. Oeil: orgelet. + hanche."
    → ["Douleurs articulaires", "Orgelet", "Douleur de hanche"]
  "Fatigue chronique depuis 2 ans, insomnies, beaucoup d'anxiété professionnelle"
    → ["Fatigue chronique", "Insomnie", "Anxiété"]
  "Cervicalgies avec irradiations vers l'épaule droite"
    → ["Cervicalgie", "Douleur épaule"]

Pouls et langue — règles d'écriture :
- Ne JAMAIS abréger les qualificatifs. Écrire le mot en entier.
  ✓ "vide"  ✗ "V"     ✓ "plein"  ✗ "P"    ✓ "tendu"  ✗ "T"
  ✓ "superficiel"  ✗ "sup."   ✓ "profond"  ✗ "prof."
  ✓ "rapide"  ✗ "r"    ✓ "lent"  ✗ "l"
- Le nom du méridien peut rester abrégé (FI = Foie, R = Rein, etc.)
  mais la qualité du pouls s'écrit en toutes lettres.
  Exemples corrects : "FI vide", "R plein", "VB tendu superficiel"

Notation des points d'acupuncture :
Les points sont notés sous la forme : NUMERO MERIDIEN [TECHNIQUE]
  Méridiens : E=Estomac, RP=Rate-Pancréas, F=Foie, VB=Vésicule Biliaire,
              V=Vessie, R=Rein, P=Poumon, GI=Gros Intestin, IG=Intestin Grêle,
              C=Cœur, TR=Triple Réchauffeur, MC=Maître Cœur,
              VG=Vaisseau Gouverneur, VC=Vaisseau Conception
  Techniques (après le code du point) :
    t   = tonifié
    d   = dispersé
    t ch = tonifié chauffé (avec moxa ou chaleur)
  Exemples : "36 E t" → code "36 E", technique "t"
             "6 RP d" → code "6 RP", technique "d"
             "4 VG t ch" → code "4 VG", technique "t ch"
             "36 E" seul → code "36 E", technique null

Pour chaque séance, extrais :
- date : date de la séance
- remarques : observations cliniques, ce que dit le patient, évolution
- pouls_langue : description du pouls et/ou de la langue (qualificatifs en toutes lettres)
- strategie : stratégie thérapeutique notée par le praticien
- points_utilises : liste d'objets {"code": "...", "technique": "t"|"d"|"t ch"|null}
- amelioration : score 0-10 si mentionné explicitement (ex "amélioration 7/10" → 7), sinon null
- a_faire_prochaine_seance : instructions pour la prochaine séance

Notes découvertes en cours de suivi :
Si le praticien note une information sur l'histoire du patient lors d'une séance
(ex: "dit avoir des migraines depuis l'enfance"), extrais-la dans notes_en_cours_de_suivi.
\
"""


def _user_content(images: list[bytes]) -> list[dict]:
    content: list[dict] = []
    for i, img_bytes in enumerate(images):
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.standard_b64encode(img_bytes).decode("ascii"),
            },
        })
        label = f"Page {i + 1}." if len(images) > 1 else "Fiche patient."
        content.append({"type": "text", "text": label})

    content.append({
        "type": "text",
        "text": (
            "Extrais les données de la fiche patient et retourne uniquement "
            "le JSON complété selon cette structure :\n\n"
            + json.dumps(_SCHEMA, ensure_ascii=False, indent=2)
        ),
    })
    return content


def _parse_response(raw: str) -> dict:
    """Extrait le JSON de la réponse, même s'il est dans un bloc ```json```."""
    text = raw.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    json_str = match.group(1) if match else text
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Réponse API non-JSON (début) : {text[:300]}"
        ) from exc


def extract(images: list[bytes], api_key: str | None = None) -> dict:
    """
    Envoie les images à Claude Vision et retourne un dict
    correspondant au schéma de la fiche patient.

    Args:
        images:  liste de bytes JPEG déjà compressés.
        api_key: clé Anthropic. Si None, lit ANTHROPIC_API_KEY.

    Returns:
        dict conforme au schéma patient.

    Raises:
        KeyError: si ANTHROPIC_API_KEY absent et api_key non fourni.
        ValueError: si la réponse n'est pas un JSON valide.
    """
    if not images:
        raise ValueError("Au moins une image est requise.")

    client = anthropic.Anthropic(
        api_key=api_key or os.environ["ANTHROPIC_API_KEY"]
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=_SYSTEM,
        messages=[{"role": "user", "content": _user_content(images)}],
    )

    return _parse_response(response.content[0].text)

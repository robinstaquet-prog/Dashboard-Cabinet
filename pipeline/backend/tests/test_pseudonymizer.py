"""
Tests unitaires pour backend/pseudonymizer.py
Run: pytest pipeline/backend/tests/test_pseudonymizer.py -v
"""
import copy
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from pipeline.backend.pseudonymizer import (
    load_mapping,
    save_mapping,
    next_code,
    find_code,
    get_or_create_code,
    anonymize,
    IDENTITY_KEYS,
    CODE_PREFIX,
)
from pipeline.backend.crypto import encrypt_json_to_file


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MAPPING_2 = {
    "P0001": {"prenom_nom": "Marie Dupont", "date_naissance": "1980-05-12",
               "telephone": "079 111 22 33", "mail": "marie@example.com",
               "adresse": "Rue de Berne 1, 1000 Lausanne",
               "profession": "Enseignante", "enfants": "2",
               "canal_communication": "SMS"},
    "P0002": {"prenom_nom": "Jean Martin", "date_naissance": "1975-03-22",
               "telephone": "079 444 55 66", "mail": "jean@example.com",
               "adresse": "Rue du Lac 5, 3000 Berne",
               "profession": "Ingénieur", "enfants": "0",
               "canal_communication": "Email"},
}

FULL_PATIENT = {
    "date_premiere_seance": "2024-01-15",
    "identite": {
        "prenom_nom": "Marie Dupont",
        "date_naissance": "1980-05-12",
        "profession": "Enseignante",
        "enfants": "2",
        "telephone": "079 111 22 33",
        "mail": "marie@example.com",
        "adresse": "Rue de Berne 1, 1000 Lausanne",
        "canal_communication": "SMS",
    },
    "motif_consultation": "Douleurs lombaires",
    "symptome": {
        "manifestation": "Douleur aiguë",
        "depuis": "3 mois",
        "aggravation_amelioration": "Aggravé par la station assise",
    },
    "histoire_personnelle": "RAS",
    "antecedents_personnels_familiaux": "Hypertension (père)",
    "traitements_en_cours": "Aucun",
    "stress_fatigue_psychique": "Stress professionnel modéré",
    "systeme_digestif": "Normal",
    "sommeil": "Perturbé",
    "cardio_vasculaire": {"observations": "Normal", "anticoagulants": None},
    "cycle_menstruel": "Régulier",
    "pouls_langue": "Pouls tendu, langue pâle",
    "seances": [
        {"numero": 1, "date": "2024-01-15", "bilan_ttt": "Première séance"},
        {"numero": 2, "date": None, "bilan_ttt": None},
    ],
}


# ---------------------------------------------------------------------------
# load_mapping / save_mapping
# ---------------------------------------------------------------------------

class TestLoadSaveMapping:
    def test_load_nonexistent_returns_empty(self, tmp_path):
        result = load_mapping(tmp_path / "missing.enc", "pw")
        assert result == {}

    def test_save_then_load_roundtrip(self, tmp_path):
        f = tmp_path / "mapping.enc"
        save_mapping(MAPPING_2, f, "master")
        result = load_mapping(f, "master")
        assert result == MAPPING_2

    def test_save_file_is_not_plaintext(self, tmp_path):
        f = tmp_path / "mapping.enc"
        save_mapping(MAPPING_2, f, "master")
        raw = f.read_bytes()
        assert b"Marie Dupont" not in raw
        assert b"P0001" not in raw

    def test_load_wrong_password_raises(self, tmp_path):
        f = tmp_path / "mapping.enc"
        save_mapping(MAPPING_2, f, "correct")
        with pytest.raises(ValueError):
            load_mapping(f, "wrong")

    def test_overwrite_updates_mapping(self, tmp_path):
        f = tmp_path / "mapping.enc"
        save_mapping({"P0001": {"prenom_nom": "Alice"}}, f, "pw")
        save_mapping({"P0001": {"prenom_nom": "Bob"}}, f, "pw")
        result = load_mapping(f, "pw")
        assert result["P0001"]["prenom_nom"] == "Bob"


# ---------------------------------------------------------------------------
# next_code
# ---------------------------------------------------------------------------

class TestNextCode:
    def test_empty_mapping_gives_p0001(self):
        assert next_code({}) == "P0001"

    def test_one_entry_gives_p0002(self):
        assert next_code({"P0001": {}}) == "P0002"

    def test_gap_in_codes_takes_max_plus_one(self):
        mapping = {"P0001": {}, "P0003": {}, "P0005": {}}
        assert next_code(mapping) == "P0006"

    def test_zero_padded_four_digits(self):
        mapping = {f"P{i:04d}": {} for i in range(1, 10)}
        assert next_code(mapping) == "P0010"

    def test_ignores_non_code_keys(self):
        mapping = {"P0001": {}, "meta": {}}
        assert next_code(mapping) == "P0002"

    def test_large_index(self):
        mapping = {"P9998": {}, "P9999": {}}
        assert next_code(mapping) == "P10000"


# ---------------------------------------------------------------------------
# find_code
# ---------------------------------------------------------------------------

class TestFindCode:
    def test_finds_existing_patient(self):
        assert find_code("Marie Dupont", MAPPING_2) == "P0001"
        assert find_code("Jean Martin", MAPPING_2) == "P0002"

    def test_returns_none_for_unknown(self):
        assert find_code("Inconnu Inconnu", MAPPING_2) is None

    def test_case_sensitive(self):
        assert find_code("marie dupont", MAPPING_2) is None

    def test_empty_mapping(self):
        assert find_code("Anyone", {}) is None


# ---------------------------------------------------------------------------
# get_or_create_code
# ---------------------------------------------------------------------------

class TestGetOrCreateCode:
    def test_creates_new_entry(self):
        mapping = {}
        identity = {"prenom_nom": "Alice Blanc", "date_naissance": "1990-01-01"}
        code, created = get_or_create_code("Alice Blanc", identity, mapping)
        assert created is True
        assert code == "P0001"
        assert mapping["P0001"]["prenom_nom"] == "Alice Blanc"

    def test_returns_existing_entry(self):
        mapping = copy.deepcopy(MAPPING_2)
        code, created = get_or_create_code("Marie Dupont", {}, mapping)
        assert created is False
        assert code == "P0001"
        assert len(mapping) == 2  # no new entry

    def test_increments_code(self):
        mapping = copy.deepcopy(MAPPING_2)
        code, created = get_or_create_code("Nouveau Patient", {"prenom_nom": "Nouveau Patient"}, mapping)
        assert created is True
        assert code == "P0003"
        assert len(mapping) == 3

    def test_prenom_nom_always_set_from_arg(self):
        mapping = {}
        identity = {"prenom_nom": "Sera_Ecrasé", "date_naissance": "2000-06-15"}
        code, _ = get_or_create_code("Vrai Nom", identity, mapping)
        assert mapping[code]["prenom_nom"] == "Vrai Nom"

    def test_two_patients_get_different_codes(self):
        mapping = {}
        code1, _ = get_or_create_code("Patient A", {}, mapping)
        code2, _ = get_or_create_code("Patient B", {}, mapping)
        assert code1 != code2

    def test_idempotent_same_patient_twice(self):
        mapping = {}
        code1, created1 = get_or_create_code("Alice", {}, mapping)
        code2, created2 = get_or_create_code("Alice", {}, mapping)
        assert code1 == code2
        assert created1 is True
        assert created2 is False
        assert len(mapping) == 1


# ---------------------------------------------------------------------------
# anonymize
# ---------------------------------------------------------------------------

class TestAnonymize:
    def test_identity_fields_replaced_by_code(self):
        anon = anonymize(FULL_PATIENT, "P0001")
        for key in FULL_PATIENT["identite"]:
            if FULL_PATIENT["identite"][key] is not None:
                assert anon["identite"][key] == "P0001", f"Field {key!r} not anonymized"

    def test_null_identity_fields_stay_null(self):
        patient = copy.deepcopy(FULL_PATIENT)
        patient["identite"]["canal_communication"] = None
        anon = anonymize(patient, "P0001")
        assert anon["identite"]["canal_communication"] is None

    def test_original_not_mutated(self):
        original = copy.deepcopy(FULL_PATIENT)
        anonymize(FULL_PATIENT, "P0001")
        assert FULL_PATIENT["identite"]["prenom_nom"] == original["identite"]["prenom_nom"]

    def test_non_identity_fields_unchanged(self):
        anon = anonymize(FULL_PATIENT, "P0001")
        assert anon["motif_consultation"] == FULL_PATIENT["motif_consultation"]
        assert anon["symptome"] == FULL_PATIENT["symptome"]
        assert anon["seances"] == FULL_PATIENT["seances"]
        assert anon["date_premiere_seance"] == FULL_PATIENT["date_premiere_seance"]

    def test_cardio_vasculaire_not_touched(self):
        anon = anonymize(FULL_PATIENT, "P0001")
        assert anon["cardio_vasculaire"]["observations"] == "Normal"
        assert anon["cardio_vasculaire"]["anticoagulants"] is None

    def test_all_identity_fields_are_code(self):
        anon = anonymize(FULL_PATIENT, "P9999")
        for val in anon["identite"].values():
            assert val is None or val == "P9999"

    def test_no_identite_section(self):
        patient = {"motif_consultation": "Douleur", "seances": []}
        anon = anonymize(patient, "P0001")
        assert anon == patient

    def test_empty_identite(self):
        patient = {"identite": {}}
        anon = anonymize(patient, "P0001")
        assert anon["identite"] == {}

    def test_fully_null_identite(self):
        patient = {"identite": {k: None for k in IDENTITY_KEYS}}
        anon = anonymize(patient, "P0001")
        for val in anon["identite"].values():
            assert val is None

"""
Tests unitaires pour backend/vision_extractor.py
(sans appel réseau — mock de l'API Anthropic)

Run: pytest pipeline/backend/tests/test_vision_extractor.py -v
"""
import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pipeline.backend.vision_extractor as ve
from pipeline.backend.vision_extractor import _parse_response, _user_content, extract


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MINIMAL_JPEG = bytes([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
])  # JPEG valide minimal (1×1 blanc)

SAMPLE_PATIENT = {
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
    "traitements_en_cours": None,
    "stress_fatigue_psychique": "Modéré",
    "systeme_digestif": "Normal",
    "sommeil": "Perturbé",
    "cardio_vasculaire": {"observations": "Normal", "anticoagulants": None},
    "cycle_menstruel": "Régulier",
    "pouls_langue": "Pouls tendu",
    "seances": [
        {"numero": i, "date": None, "bilan_ttt": None} for i in range(1, 7)
    ],
}


def make_mock_client(response_text: str) -> MagicMock:
    """Retourne un mock anthropic.Anthropic dont messages.create retourne response_text."""
    mock_content = MagicMock()
    mock_content.text = response_text
    mock_response = MagicMock()
    mock_response.content = [mock_content]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    return mock_client


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------

class TestParseResponse:
    def test_plain_json(self):
        raw = json.dumps(SAMPLE_PATIENT)
        assert _parse_response(raw) == SAMPLE_PATIENT

    def test_json_in_code_block(self):
        raw = f"```json\n{json.dumps(SAMPLE_PATIENT)}\n```"
        assert _parse_response(raw) == SAMPLE_PATIENT

    def test_json_in_generic_code_block(self):
        raw = f"```\n{json.dumps(SAMPLE_PATIENT)}\n```"
        assert _parse_response(raw) == SAMPLE_PATIENT

    def test_whitespace_stripped(self):
        raw = f"   \n{json.dumps(SAMPLE_PATIENT)}\n   "
        assert _parse_response(raw) == SAMPLE_PATIENT

    def test_invalid_json_raises_value_error(self):
        with pytest.raises(ValueError, match="non-JSON"):
            _parse_response("Voici les données du patient : { invalid }")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            _parse_response("")

    def test_partial_json_raises(self):
        with pytest.raises(ValueError):
            _parse_response('{"prenom_nom": "Marie"')


# ---------------------------------------------------------------------------
# _user_content
# ---------------------------------------------------------------------------

class TestUserContent:
    def test_single_image_encoded_as_base64(self):
        content = _user_content([MINIMAL_JPEG])
        image_blocks = [b for b in content if b.get("type") == "image"]
        assert len(image_blocks) == 1
        encoded = image_blocks[0]["source"]["data"]
        assert base64.standard_b64decode(encoded) == MINIMAL_JPEG

    def test_media_type_is_jpeg(self):
        content = _user_content([MINIMAL_JPEG])
        image_blocks = [b for b in content if b.get("type") == "image"]
        assert image_blocks[0]["source"]["media_type"] == "image/jpeg"

    def test_source_type_is_base64(self):
        content = _user_content([MINIMAL_JPEG])
        image_blocks = [b for b in content if b.get("type") == "image"]
        assert image_blocks[0]["source"]["type"] == "base64"

    def test_multiple_images_all_encoded(self):
        images = [MINIMAL_JPEG, MINIMAL_JPEG, MINIMAL_JPEG]
        content = _user_content(images)
        image_blocks = [b for b in content if b.get("type") == "image"]
        assert len(image_blocks) == 3

    def test_single_image_label_no_page_number(self):
        content = _user_content([MINIMAL_JPEG])
        text_blocks = [b for b in content if b.get("type") == "text"]
        labels = [b["text"] for b in text_blocks if "Page" in b["text"] or "Fiche" in b["text"]]
        assert any("Fiche patient" in l for l in labels)

    def test_multiple_images_have_page_labels(self):
        content = _user_content([MINIMAL_JPEG, MINIMAL_JPEG])
        text_blocks = [b for b in content if b.get("type") == "text"]
        labels = [b["text"] for b in text_blocks]
        assert any("Page 1" in l for l in labels)
        assert any("Page 2" in l for l in labels)

    def test_last_block_contains_schema(self):
        content = _user_content([MINIMAL_JPEG])
        last = content[-1]
        assert last["type"] == "text"
        assert "date_premiere_seance" in last["text"]


# ---------------------------------------------------------------------------
# extract (avec mock)
# ---------------------------------------------------------------------------

class TestExtract:
    def test_returns_dict_from_api(self):
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            result = extract([MINIMAL_JPEG], api_key="sk-test")
        assert result == SAMPLE_PATIENT

    def test_uses_provided_api_key(self):
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value = mock_client
            extract([MINIMAL_JPEG], api_key="sk-my-key")
            MockAnthropic.assert_called_once_with(api_key="sk-my-key")

    def test_uses_env_var_when_no_api_key(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env-key")
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic") as MockAnthropic:
            MockAnthropic.return_value = mock_client
            extract([MINIMAL_JPEG])
            MockAnthropic.assert_called_once_with(api_key="sk-env-key")

    def test_api_called_with_correct_model(self):
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            extract([MINIMAL_JPEG], api_key="sk-test")
        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert call_kwargs["model"] == ve.MODEL

    def test_api_called_once(self):
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            extract([MINIMAL_JPEG, MINIMAL_JPEG], api_key="sk-test")
        assert mock_client.messages.create.call_count == 1

    def test_handles_json_in_code_block(self):
        raw = f"```json\n{json.dumps(SAMPLE_PATIENT)}\n```"
        mock_client = make_mock_client(raw)
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            result = extract([MINIMAL_JPEG], api_key="sk-test")
        assert result == SAMPLE_PATIENT

    def test_raises_value_error_on_bad_json(self):
        mock_client = make_mock_client("Désolé, je ne peux pas traiter cette image.")
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            with pytest.raises(ValueError, match="non-JSON"):
                extract([MINIMAL_JPEG], api_key="sk-test")

    def test_raises_on_empty_images(self):
        with pytest.raises(ValueError, match="Au moins une image"):
            extract([], api_key="sk-test")

    def test_multiple_images_sent_in_one_call(self):
        mock_client = make_mock_client(json.dumps(SAMPLE_PATIENT))
        with patch("pipeline.backend.vision_extractor.anthropic.Anthropic", return_value=mock_client):
            extract([MINIMAL_JPEG, MINIMAL_JPEG, MINIMAL_JPEG], api_key="sk-test")
        content = mock_client.messages.create.call_args.kwargs["messages"][0]["content"]
        image_blocks = [b for b in content if b.get("type") == "image"]
        assert len(image_blocks) == 3

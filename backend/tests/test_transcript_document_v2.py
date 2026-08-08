import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.contracts.transcript_document_v2 import TranscriptDocumentV2, to_transcript_document_v2

FIXTURES = Path(__file__).parents[2] / "contracts" / "fixtures" / "transcript-document-v2"
def load(name): return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

@pytest.mark.parametrize("name", ["english-words.json", "hinglish.json", "telgish-manual.json", "multiple-speakers-overlap.json", "empty.json", "low-confidence.json"])
def test_valid_fixtures_round_trip(name):
    raw=load(name); assert json.loads(TranscriptDocumentV2.model_validate(raw).model_dump_json()) == raw
def test_invalid_timestamp_and_references_reject():
    with pytest.raises(ValidationError): TranscriptDocumentV2.model_validate(load("invalid-negative.json"))
    raw=load("english-words.json"); raw["words"][0]["segmentId"]="missing"
    with pytest.raises(ValidationError, match="unknown word segment"): TranscriptDocumentV2.model_validate(raw)
    raw=load("english-words.json"); raw["segments"][0]["startMs"]=1300
    with pytest.raises(ValidationError, match="invalid segment timestamp range"): TranscriptDocumentV2.model_validate(raw)
    raw=load("english-words.json"); raw["schemaVersion"]=1
    with pytest.raises(ValidationError): TranscriptDocumentV2.model_validate(raw)
def test_duplicate_ids_and_confidence_reject():
    raw=load("english-words.json"); raw["words"].append(dict(raw["words"][0]))
    with pytest.raises(ValidationError, match="duplicate word id"): TranscriptDocumentV2.model_validate(raw)
    raw=load("english-words.json"); raw["words"][0]["confidence"]=1.1
    with pytest.raises(ValidationError): TranscriptDocumentV2.model_validate(raw)
def test_current_normalized_adapter_preserves_text_time_and_ids():
    source={"languageMode":"auto","provider":"sarvam","segments":[{"start":1.2,"end":2.0,"text":"Shown","words":[{"word":"shown","displayedWord":"Shown","originalWord":"shown","start":1.2,"end":1.6,"confidence":0.8,"timing_source":"provider_word"}]}]}
    doc=to_transcript_document_v2(source, transcript_id="tr", media_id="media", duration_ms=3000)
    assert doc.segments[0].id=="seg_000001" and doc.words[0].id=="word_000001"
    assert (doc.words[0].text,doc.words[0].originalText,doc.words[0].startMs,doc.words[0].endMs)==("Shown","shown",1200,1600)

import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.contracts.remapped_transcript_v1 import RemappedTranscriptV1
F=Path(__file__).parents[2]/"contracts/fixtures/remapped-transcript-v1"
def load(k,n):return json.loads((F/k/n).read_text())
@pytest.mark.parametrize("path", sorted((F/"valid").glob("*.json")), ids=lambda p:p.name)
def test_valid_fixtures(path):
 raw=json.loads(path.read_text(encoding="utf-8"));model=RemappedTranscriptV1.model_validate(raw)
 assert json.loads(model.model_dump_json())==raw
@pytest.mark.parametrize("path", sorted((F/"invalid").glob("*.json")), ids=lambda p:p.name)
def test_invalid_fixtures(path):
 with pytest.raises(ValidationError):RemappedTranscriptV1.model_validate_json(path.read_text(encoding="utf-8"))

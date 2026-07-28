import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.contracts.edit_decision_list_v1 import EditDecisionListV1
F=Path(__file__).parents[2]/"contracts/fixtures/edit-decision-list-v1"
def load(k,n):return json.loads((F/k/n).read_text())
@pytest.mark.parametrize("path", sorted((F/"valid").glob("*.json")), ids=lambda p:p.name)
def test_valid_fixtures(path):
 raw=json.loads(path.read_text(encoding="utf-8"));model=EditDecisionListV1.model_validate(raw)
 assert json.loads(model.model_dump_json())==raw
@pytest.mark.parametrize("path", sorted((F/"invalid").glob("*.json")), ids=lambda p:p.name)
def test_invalid_fixtures(path):
 with pytest.raises(ValidationError):EditDecisionListV1.model_validate_json(path.read_text(encoding="utf-8"))

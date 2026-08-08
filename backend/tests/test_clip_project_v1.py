import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from backend.contracts.clip_project_v1 import ClipProjectV1
F=Path(__file__).parents[2]/"contracts/fixtures/clip-project-v1"
def load(n): return json.loads((F/n).read_text(encoding="utf-8"))
@pytest.mark.parametrize("name",["empty.json","one-range.json"])
def test_round_trip(name): raw=load(name); assert json.loads(ClipProjectV1.model_validate(raw).model_dump_json())==raw
@pytest.mark.parametrize("path,value,error",[("sourceStartMs",-1,"greater than or equal"),("sourceEndMs",12000,"invalid_range_duration"),("playbackRate",5,"less than or equal"),("schemaVersion",2,"Input should be 1")])
def test_invalid_ranges(path,value,error):
 raw=load("one-range.json");raw["ranges"][0][path]=value
 with pytest.raises(ValidationError,match=error):ClipProjectV1.model_validate(raw)
def test_duplicate_order_and_overlap_allowed():
 raw=load("one-range.json"); second=dict(raw["ranges"][0],id="range_002",sourceStartMs=15000,sourceEndMs=20000,order=1); raw["ranges"].append(second); assert len(ClipProjectV1.model_validate(raw).ranges)==2
 raw["ranges"][1]["order"]=0
 with pytest.raises(ValidationError,match="duplicate_range_order"):ClipProjectV1.model_validate(raw)

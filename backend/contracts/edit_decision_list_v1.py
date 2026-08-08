from typing import Any, Literal
from pydantic import Field, model_validator
from .transcript_document_v2 import ContractModel
class ClipDomainWarning(ContractModel): category:str; message:str; rangeId:str|None=None
class EditDecisionListEntryV1(ContractModel):
 id:str; rangeId:str; order:int=Field(ge=0); sourceMediaId:str; sourceStartMs:int=Field(ge=0); sourceEndMs:int=Field(ge=0); sourceDurationMs:int=Field(ge=0); outputStartMs:int=Field(ge=0); outputEndMs:int=Field(ge=0); outputDurationMs:int=Field(ge=0); playbackRate:float=Field(ge=.25,le=4); transitionIn:dict[str,Any]|None=None; transitionOut:dict[str,Any]|None=None; metadata:dict[str,Any]=Field(default_factory=dict)
class EditDecisionListV1(ContractModel):
 schemaVersion:Literal[1]=1;clipProjectId:str;projectRevision:int=Field(ge=1);sourceMediaId:str;sourceDurationMs:int=Field(ge=0);outputDurationMs:int=Field(ge=0);entries:list[EditDecisionListEntryV1]=Field(default_factory=list);warnings:list[ClipDomainWarning]=Field(default_factory=list);metadata:dict[str,Any]=Field(default_factory=dict)
 @model_validator(mode="after")
 def contiguous(self):
  cursor=0;ids=set()
  for e in self.entries:
   if e.id in ids or e.outputStartMs!=cursor or e.outputEndMs-e.outputStartMs!=e.outputDurationMs:raise ValueError("invalid_edl")
   ids.add(e.id);cursor=e.outputEndMs
  if cursor!=self.outputDurationMs:raise ValueError("invalid_edl")
  return self

from typing import Any, Literal
from pydantic import Field, model_validator
from .transcript_document_v2 import ContractModel
TimingSource=Literal["provider","aligned","interpolated","estimated","manuallyAdjusted","unknown"]
class TranscriptMappingOptionsV1(ContractModel): boundaryPolicy:Literal["contained","intersecting","clipped"]="clipped"; untimedWordPolicy:Literal["excludeWithWarning","preserveUntimed"]="excludeWithWarning"
class RemappedWarning(ContractModel): category:str;message:str;rangeId:str|None=None
class RemappedWordOccurrenceV1(ContractModel):
 occurrenceId:str;sourceWordId:str;sourceSegmentId:str;rangeId:str;text:str;originalText:str|None=None;originalSourceStartMs:int|None=None;originalSourceEndMs:int|None=None;effectiveSourceStartMs:int|None=None;effectiveSourceEndMs:int|None=None;outputStartMs:int|None=None;outputEndMs:int|None=None;speakerId:str|None=None;language:str|None=None;confidence:float|None=Field(default=None,ge=0,le=1);timingSource:TimingSource;isFiller:bool=False;isLowConfidence:bool=False;metadata:dict[str,Any]=Field(default_factory=dict)
 @model_validator(mode="after")
 def timing(self):
  for a,b in ((self.originalSourceStartMs,self.originalSourceEndMs),(self.effectiveSourceStartMs,self.effectiveSourceEndMs),(self.outputStartMs,self.outputEndMs)):
   if (a is None)!=(b is None) or (a is not None and (a<0 or b<a)):raise ValueError("invalid occurrence timing")
  return self
class RemappedSegmentOccurrenceV1(ContractModel):
 occurrenceId:str;sourceSegmentId:str;rangeId:str;text:str;originalText:str|None=None;originalSourceStartMs:int|None=None;originalSourceEndMs:int|None=None;effectiveSourceStartMs:int|None=None;effectiveSourceEndMs:int|None=None;outputStartMs:int|None=None;outputEndMs:int|None=None;wordOccurrenceIds:list[str]=Field(default_factory=list);speakerId:str|None=None;language:str|None=None;confidence:float|None=Field(default=None,ge=0,le=1);timingSource:TimingSource;metadata:dict[str,Any]=Field(default_factory=dict)
class RemappedTranscriptV1(ContractModel):
 schemaVersion:Literal[1]=1;sourceTranscriptId:str;clipProjectId:str;projectRevision:int=Field(ge=1);sourceMediaId:str;outputDurationMs:int=Field(ge=0);segments:list[RemappedSegmentOccurrenceV1]=Field(default_factory=list);words:list[RemappedWordOccurrenceV1]=Field(default_factory=list);warnings:list[RemappedWarning]=Field(default_factory=list);metadata:dict[str,Any]=Field(default_factory=dict)
 @model_validator(mode="after")
 def refs(self):
  ids=[w.occurrenceId for w in self.words]
  if len(ids)!=len(set(ids)):raise ValueError("duplicate word occurrence")
  segment_ids=[s.occurrenceId for s in self.segments]
  if len(segment_ids)!=len(set(segment_ids)):raise ValueError("duplicate segment occurrence")
  words=set(ids)
  for s in self.segments:
   if any(x not in words for x in s.wordOccurrenceIds):raise ValueError("missing word occurrence")
  for x in [*self.words,*self.segments]:
   if x.outputEndMs is not None and x.outputEndMs>self.outputDurationMs:raise ValueError("output exceeds duration")
  return self

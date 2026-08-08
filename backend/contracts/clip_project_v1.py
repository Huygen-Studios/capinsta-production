"""Non-destructive ClipProjectV1 models; persisted times are integer milliseconds."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import Field, model_validator
from .transcript_document_v2 import ContractModel, TranscriptDocumentV2

SourceType = Literal["uploaded", "recorded", "imported", "generated", "unknown"]
ProjectStatus = Literal["draft", "processing", "ready", "exporting", "exported", "failed", "archived"]
class SourceMediaReferenceV1(ContractModel):
 mediaId: str = Field(min_length=1); durationMs: int = Field(ge=0); sourceType: SourceType = "unknown"; displayName: str | None = None; mimeType: str | None = None; storageKey: str | None = None; checksum: str | None = None; metadata: dict[str, Any] = Field(default_factory=dict)
class ClipSelectionReferenceV1(ContractModel):
 transcriptId: str | None = None; transcriptRevision: int | None = Field(default=None, ge=1); startWordId: str | None = None; endWordId: str | None = None; startSegmentId: str | None = None; endSegmentId: str | None = None
class ClipBoundaryV1(ContractModel):
 preRollMs: int = Field(default=0, ge=0); postRollMs: int = Field(default=0, ge=0); startAdjustedManually: bool = False; endAdjustedManually: bool = False
class ClipRangeV1(ContractModel):
 schemaVersion: Literal[1] = 1; id: str = Field(min_length=1); sourceMediaId: str = Field(min_length=1); sourceStartMs: int = Field(ge=0); sourceEndMs: int = Field(ge=0); order: int = Field(ge=0); playbackRate: float = Field(default=1.0, ge=0.25, le=4.0); selection: ClipSelectionReferenceV1 | None = None; boundary: ClipBoundaryV1 = Field(default_factory=ClipBoundaryV1); transitionIn: dict[str, Any] | None = None; transitionOut: dict[str, Any] | None = None; enabled: bool = True; label: str | None = None; metadata: dict[str, Any] = Field(default_factory=dict)
 @model_validator(mode="after")
 def range_is_positive(self):
  if self.sourceEndMs <= self.sourceStartMs: raise ValueError("invalid_range_duration")
  return self
class ClipCanvasV1(ContractModel):
 aspectRatio: Literal["9:16", "16:9", "1:1", "4:5", "custom"]; width: int = Field(gt=0); height: int = Field(gt=0); background: str | None = None; safeArea: dict[str, Any] | None = None; metadata: dict[str, Any] = Field(default_factory=dict)
 @model_validator(mode="after")
 def ratio_matches_dimensions(self):
  ratios={"9:16":9/16,"16:9":16/9,"1:1":1,"4:5":4/5}
  if self.aspectRatio in ratios and abs(self.width/self.height-ratios[self.aspectRatio])>0.02: raise ValueError("invalid_canvas")
  return self
class CaptionTrackReferenceV1(ContractModel):
 captionTrackId: str = Field(min_length=1); transcriptId: str | None = None; stylePresetId: str | None = None; enabled: bool = True; metadata: dict[str, Any] = Field(default_factory=dict)
class ClipProjectSettingsV1(ContractModel):
 defaultPreRollMs: int = Field(default=0, ge=0); defaultPostRollMs: int = Field(default=0, ge=0); snapToWords: bool = True; snapToSegments: bool = True; preserveBreathingRoom: bool = True; metadata: dict[str, Any] = Field(default_factory=dict)
class ClipProjectV1(ContractModel):
 schemaVersion: Literal[1] = 1; clipProjectId: str = Field(min_length=1); workspaceId: str | None = None; name: str; sourceMedia: SourceMediaReferenceV1; transcriptId: str | None = None; transcriptRevision: int | None = Field(default=None, ge=1); ranges: list[ClipRangeV1] = Field(default_factory=list); canvas: ClipCanvasV1; captionTrack: CaptionTrackReferenceV1 | None = None; settings: ClipProjectSettingsV1 = Field(default_factory=ClipProjectSettingsV1); status: ProjectStatus = "draft"; revision: int = Field(default=1, ge=1); metadata: dict[str, Any] = Field(default_factory=dict); createdAt: datetime; updatedAt: datetime
 @model_validator(mode="after")
 def validate_project(self):
  ids=[r.id for r in self.ranges]
  if len(ids)!=len(set(ids)): raise ValueError("duplicate_range_id")
  orders=[r.order for r in self.ranges if r.enabled]
  if len(orders)!=len(set(orders)): raise ValueError("duplicate_range_order")
  for r in self.ranges:
   if r.sourceMediaId != self.sourceMedia.mediaId: raise ValueError("media_reference_mismatch")
   if r.sourceEndMs > self.sourceMedia.durationMs: raise ValueError("range_exceeds_media")
   if r.selection and r.selection.transcriptId and self.transcriptId and r.selection.transcriptId != self.transcriptId: raise ValueError("transcript_reference_missing")
  if self.captionTrack and self.captionTrack.transcriptId and self.transcriptId and self.captionTrack.transcriptId != self.transcriptId: raise ValueError("transcript_reference_missing")
  return self
def validate_clip_project_against_transcript(project: ClipProjectV1, transcript: TranscriptDocumentV2 | None) -> list[dict[str, Any]]:
 """Return structured compatibility issues; timestamp-only projects need no transcript."""
 if transcript is None: return []
 issues=[]
 if project.transcriptId and project.transcriptId != transcript.transcriptId: issues.append({"category":"transcript_reference_missing","fieldPath":"transcriptId","entityId":project.clipProjectId,"message":"project transcriptId does not match"})
 if transcript.durationMs != project.sourceMedia.durationMs: issues.append({"category":"transcript_reference_missing","fieldPath":"sourceMedia.durationMs","entityId":project.clipProjectId,"message":"transcript and source durations differ"})
 word={w.id:w for w in transcript.words}; segment={s.id:s for s in transcript.segments}; indices={w.id:i for i,w in enumerate(transcript.words)}
 for r in project.ranges:
  s=r.selection
  if not s: continue
  if s.transcriptId and s.transcriptId != transcript.transcriptId: issues.append({"category":"transcript_reference_missing","fieldPath":"selection.transcriptId","entityId":r.id,"message":"selection transcript mismatch"}); continue
  for field, collection in (("startWordId",word),("endWordId",word),("startSegmentId",segment),("endSegmentId",segment)):
   value=getattr(s,field)
   if value and value not in collection: issues.append({"category":"transcript_reference_missing","fieldPath":f"selection.{field}","entityId":r.id,"message":"referenced transcript entity is missing"})
  if s.startWordId and s.endWordId and s.startWordId in indices and s.endWordId in indices and indices[s.startWordId]>indices[s.endWordId]: issues.append({"category":"transcript_reference_reversed","fieldPath":"selection","entityId":r.id,"message":"word selection is reversed"})
  if s.transcriptRevision and s.transcriptRevision != project.transcriptRevision: issues.append({"category":"transcript_revision_mismatch","fieldPath":"selection.transcriptRevision","entityId":r.id,"message":"selection revision is stale"})
 return issues

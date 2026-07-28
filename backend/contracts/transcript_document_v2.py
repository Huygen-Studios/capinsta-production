"""Canonical TranscriptDocumentV2 contract. JSON names intentionally match the schema."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

TimingSource = Literal["provider", "aligned", "interpolated", "estimated", "manuallyAdjusted", "unknown"]

class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Provider(ContractModel):
    name: str
    model: str | None = None
    requestId: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

class Segment(ContractModel):
    id: str; startMs: int; endMs: int; text: str; originalText: str | None = None
    speakerId: str | None = None; language: str | None = None; confidence: float | None = Field(default=None, ge=0, le=1)
    wordIds: list[str] = Field(default_factory=list); timingSource: TimingSource = "unknown"; metadata: dict[str, Any] = Field(default_factory=dict)
    @model_validator(mode="after")
    def valid_range(self):
        if self.startMs < 0 or self.endMs < self.startMs: raise ValueError("invalid segment timestamp range")
        return self

class Word(ContractModel):
    id: str; segmentId: str; text: str; originalText: str | None = None
    startMs: int | None = Field(default=None, ge=0); endMs: int | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1); speakerId: str | None = None; language: str | None = None
    timingSource: TimingSource = "unknown"; isFiller: bool = False; isLowConfidence: bool = False; metadata: dict[str, Any] = Field(default_factory=dict)
    @model_validator(mode="after")
    def valid_range(self):
        if (self.startMs is None) != (self.endMs is None): raise ValueError("word timestamps must both be present or absent")
        if self.startMs is not None and self.endMs is not None and self.endMs < self.startMs: raise ValueError("invalid word timestamp range")
        return self

class Speaker(ContractModel):
    id: str; label: str; displayName: str | None = None; confidence: float | None = Field(default=None, ge=0, le=1); metadata: dict[str, Any] = Field(default_factory=dict)
class SilenceRegion(ContractModel):
    id: str; startMs: int; endMs: int; confidence: float | None = Field(default=None, ge=0, le=1); source: str; metadata: dict[str, Any] = Field(default_factory=dict)
    @model_validator(mode="after")
    def valid_range(self):
        if self.startMs < 0 or self.endMs < self.startMs: raise ValueError("invalid silence timestamp range")
        return self
class Quality(ContractModel):
    overallScore: float | None = Field(default=None, ge=0, le=1); timingScore: float | None = Field(default=None, ge=0, le=1); confidenceScore: float | None = Field(default=None, ge=0, le=1)
    lowConfidenceWordCount: int = Field(default=0, ge=0); untimedWordCount: int = Field(default=0, ge=0); overlapCount: int = Field(default=0, ge=0); warnings: list[str] = Field(default_factory=list)

class TranscriptDocumentV2(ContractModel):
    schemaVersion: Literal[2] = 2; transcriptId: str; mediaId: str; durationMs: int = Field(ge=0); languageMode: str
    detectedLanguages: list[str] = Field(default_factory=list); provider: Provider; segments: list[Segment] = Field(default_factory=list); words: list[Word] = Field(default_factory=list)
    speakers: list[Speaker] = Field(default_factory=list); silenceRegions: list[SilenceRegion] = Field(default_factory=list); quality: Quality = Field(default_factory=Quality); metadata: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime; updatedAt: datetime
    @model_validator(mode="after")
    def validate_references(self):
        for items, label in ((self.segments,"segment"),(self.words,"word"),(self.speakers,"speaker"),(self.silenceRegions,"silence region")):
            ids=[x.id for x in items]
            if len(ids)!=len(set(ids)): raise ValueError(f"duplicate {label} id")
        segments={x.id:x for x in self.segments}; words={x.id for x in self.words}; speakers={x.id for x in self.speakers}
        for segment in self.segments:
            if segment.endMs > self.durationMs: raise ValueError("segment exceeds durationMs")
            if segment.speakerId and segment.speakerId not in speakers: raise ValueError("unknown segment speaker")
            if len(segment.wordIds) != len(set(segment.wordIds)) or any(word_id not in words for word_id in segment.wordIds): raise ValueError("unknown or duplicate segment word reference")
        for word in self.words:
            if word.segmentId not in segments: raise ValueError("unknown word segment")
            if word.speakerId and word.speakerId not in speakers: raise ValueError("unknown word speaker")
            if word.endMs is not None and word.endMs > self.durationMs: raise ValueError("word exceeds durationMs")
        for silence in self.silenceRegions:
            if silence.endMs > self.durationMs: raise ValueError("silence exceeds durationMs")
        return self

def _ms(value: Any) -> int | None:
    return None if value is None else round(float(value) * 1000)
def _source(value: Any) -> TimingSource:
    value=str(value or "").lower()
    if "manual" in value: return "manuallyAdjusted"
    if "align" in value: return "aligned"
    if "interpol" in value: return "interpolated"
    if any(x in value for x in ("estimated","synthetic","fallback","segment_derived")): return "estimated"
    return "provider" if "provider" in value else "unknown"
def to_transcript_document_v2(transcript: dict[str, Any], *, transcript_id: str, media_id: str, duration_ms: int, created_at: datetime | None = None) -> TranscriptDocumentV2:
    """Adapt the current normalized seconds-based pipeline response without changing it."""
    now=created_at or datetime.now(timezone.utc); raw_segments=transcript.get("segments") or []; all_words=[]; segments=[]
    for si, raw in enumerate(raw_segments, 1):
        seg_id=str(raw.get("id") or f"seg_{si:06d}"); raw_words=raw.get("words") or []; ids=[]
        for wi, item in enumerate(raw_words, 1):
            word_id=str(item.get("id") or f"word_{len(all_words)+1:06d}"); ids.append(word_id)
            all_words.append(Word(id=word_id, segmentId=seg_id, text=str(item.get("displayedWord") or item.get("word") or item.get("text") or ""), originalText=item.get("originalWord") or item.get("spokenWord"), startMs=_ms(item.get("start")), endMs=_ms(item.get("end")), confidence=item.get("confidence"), language=item.get("languageHint"), speakerId=item.get("speakerId"), timingSource=_source(item.get("timingSource") or item.get("timing_source")), metadata={k:v for k,v in item.items() if k not in {"id","word","text","displayedWord","originalWord","spokenWord","start","end","confidence","languageHint","speakerId","timingSource","timing_source"}}))
        segments.append(Segment(id=seg_id,startMs=_ms(raw.get("start")) or 0,endMs=_ms(raw.get("end")) or 0,text=str(raw.get("text") or ""),originalText=raw.get("originalText"),speakerId=raw.get("speakerId"),language=raw.get("language"),confidence=raw.get("confidence"),wordIds=ids,timingSource=_source(raw.get("timingSource")),metadata={k:v for k,v in raw.items() if k not in {"id","start","end","text","originalText","speakerId","language","confidence","words","timingSource"}}))
    provider=transcript.get("provider"); provider=Provider(name=provider if isinstance(provider,str) else (provider or {}).get("name","unknown"),model=None if isinstance(provider,str) else (provider or {}).get("model"),metadata={} if isinstance(provider,str) else dict((provider or {}).get("metadata") or {}))
    return TranscriptDocumentV2(transcriptId=transcript_id,mediaId=media_id,durationMs=duration_ms,languageMode=str(transcript.get("languageMode") or "auto"),detectedLanguages=[x for x in [transcript.get("detectedLanguage"),transcript.get("sourceLanguage")] if x],provider=provider,segments=segments,words=all_words,createdAt=now,updatedAt=now)

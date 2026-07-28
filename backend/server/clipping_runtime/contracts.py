from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

try:
    from contracts.edit_decision_list_v1 import EditDecisionListV1
    from contracts.remapped_transcript_v1 import RemappedTranscriptV1
except ImportError:
    from backend.contracts.edit_decision_list_v1 import EditDecisionListV1
    from backend.contracts.remapped_transcript_v1 import RemappedTranscriptV1


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RuntimeErrorV1(StrictModel):
    code: str
    message: str
    fieldPath: str | None = None


class RuntimeResponseV1(StrictModel):
    protocolVersion: Literal[1]
    requestId: str
    ok: bool
    result: dict[str, Any] | None
    warnings: list[str] = Field(default_factory=list)
    error: RuntimeErrorV1 | None

    @model_validator(mode="after")
    def result_matches_status(self):
        if self.ok != (self.result is not None and self.error is None):
            raise ValueError("invalid runtime response status")
        return self


class RuntimeVersionResultV1(StrictModel):
    runtimeVersion: str
    protocolVersions: list[int]
    operations: list[str]


class RuntimeHealthResultV1(StrictModel):
    status: Literal["healthy"]
    linkedEngines: list[str]


class DerivationSummaryV1(StrictModel):
    projectId: str
    projectRevision: int = Field(ge=1)
    entryCount: int = Field(ge=0)
    outputDurationMs: int = Field(ge=0)
    remappedWordCount: int = Field(ge=0)
    remappedSegmentCount: int = Field(ge=0)


class DerivationRuntimeResultV1(StrictModel):
    editDecisionList: EditDecisionListV1
    remappedTranscript: RemappedTranscriptV1 | None
    summary: DerivationSummaryV1

    @model_validator(mode="after")
    def provenance(self):
        edl = self.editDecisionList
        if (
            self.summary.projectId != edl.clipProjectId
            or self.summary.projectRevision != edl.projectRevision
            or self.summary.entryCount != len(edl.entries)
            or self.summary.outputDurationMs != edl.outputDurationMs
        ):
            raise ValueError("invalid derivation summary")
        if self.remappedTranscript is not None and (
            self.remappedTranscript.clipProjectId != edl.clipProjectId
            or self.remappedTranscript.projectRevision != edl.projectRevision
            or self.remappedTranscript.sourceMediaId != edl.sourceMediaId
            or self.remappedTranscript.outputDurationMs != edl.outputDurationMs
            or self.summary.remappedWordCount != len(self.remappedTranscript.words)
            or self.summary.remappedSegmentCount != len(self.remappedTranscript.segments)
        ):
            raise ValueError("invalid remapped transcript provenance")
        return self


class ConversionRuntimeResultV1(BaseModel):
    model_config = ConfigDict(extra="allow")
    schemaVersion: Literal[1]
    sourceClipProjectId: str
    sourceClipProjectRevision: int = Field(ge=1)
    targetProjectId: str
    project: dict[str, Any]
    mediaReference: dict[str, Any]
    mapping: dict[str, Any]
    warnings: list[dict[str, Any]]
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def required_contract_shape(self):
        if self.project.get("version") != 35:
            raise ValueError("invalid Capinsta project version")
        if self.mediaReference.get("requiresMediaAttachment") is not True:
            raise ValueError("media attachment requirement is missing")
        if self.mapping.get("sourceMediaId") is None:
            raise ValueError("conversion mapping is incomplete")
        return self


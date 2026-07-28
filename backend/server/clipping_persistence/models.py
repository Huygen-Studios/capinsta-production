from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

JobStatus = Literal[
    "queued",
    "claimed",
    "running",
    "succeeded",
    "failed",
    "retry_wait",
    "cancel_requested",
    "cancelled",
    "expired",
]
JobType = Literal[
    "media_probe",
    "proxy_generation",
    "audio_extraction",
    "thumbnail_generation",
    "waveform_generation",
    "transcription",
    "transcript_analysis",
    "silence_analysis",
    "highlight_analysis",
    "clip_export",
    "caption_export",
    "project_derivation",
    "project_conversion",
]

ALLOWED_JOB_TRANSITIONS: dict[str, frozenset[str]] = {
    "queued": frozenset({"claimed", "cancel_requested", "cancelled"}),
    "claimed": frozenset({"running", "retry_wait", "failed", "cancel_requested"}),
    "running": frozenset(
        {"succeeded", "failed", "retry_wait", "cancel_requested"}
    ),
    "retry_wait": frozenset({"queued", "cancel_requested", "cancelled"}),
    "cancel_requested": frozenset({"cancelled", "failed"}),
    "succeeded": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
    "expired": frozenset(),
}
TERMINAL_JOB_STATUSES = frozenset({"succeeded", "failed", "cancelled", "expired"})


@dataclass(frozen=True)
class AuthenticatedActor:
    """Trusted identity created only after Supabase JWT verification."""

    user_id: UUID
    workspace_ids: tuple[UUID, ...] = ()
    is_service_role: bool = False

    @classmethod
    def from_verified_user(cls, user_id: str) -> "AuthenticatedActor":
        return cls(user_id=UUID(user_id))


class JobInputEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[1] = 1
    jobType: JobType
    metadata: dict[str, Any] = Field(default_factory=dict)


class TranscriptionOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wordTimestamps: Literal[True] = True
    speakerLabels: Literal[False] = False
    preserveFillers: Literal[True] = True


class TranscriptionJobInput(JobInputEnvelope):
    """Queue-envelope compatibility; production handler applies strict V1."""

    jobType: Literal["transcription"]
    mediaAssetId: UUID
    expectedMediaRevision: int | None = Field(default=None, ge=1)
    storageObjectRevision: int | None = Field(default=None, ge=1)
    audioVariantId: UUID | None = None
    audioVariantRevision: int | None = Field(default=None, ge=1)
    transcriptId: str | None = Field(
        default=None, pattern=r"^tr_[A-Za-z0-9_-]{1,124}$"
    )
    requestIdentity: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{64}$"
    )
    languageMode: str = "auto"
    providerPreference: Literal["sarvam", "openai", "gemini"] | None = None
    hotwords: list[str] = Field(default_factory=list, max_length=100)
    options: TranscriptionOptions = Field(default_factory=TranscriptionOptions)


class ClipExportJobInput(JobInputEnvelope):
    jobType: Literal["clip_export", "caption_export"]
    clipProjectId: str
    expectedRevision: int = Field(ge=1)


class ProjectConversionJobInput(JobInputEnvelope):
    jobType: Literal["project_conversion"]
    clipProjectId: str
    expectedRevision: int = Field(ge=1)
    targetProjectSchemaVersion: int = Field(default=35, ge=1)
    targetProjectId: str | None = None
    includeCaptions: bool = True
    requestIdentity: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ProjectDerivationJobInput(JobInputEnvelope):
    jobType: Literal["project_derivation"]
    clipProjectId: str
    expectedRevision: int = Field(ge=1)
    transcriptId: str
    expectedTranscriptRevision: int = Field(ge=1)
    expectedMediaRevision: int = Field(ge=1)
    includeRemappedTranscript: bool = True
    requestIdentity: str = Field(pattern=r"^[0-9a-f]{64}$")


class MediaProbeJobInput(JobInputEnvelope):
    jobType: Literal["media_probe"]
    # The durable orchestration repository also supports synthetic queue tests
    # without a media target. The production handler applies its stricter
    # MediaProbeJobInputV1 contract before execution.
    mediaAssetId: UUID | None = None
    expectedMediaRevision: int | None = Field(default=None, ge=1)
    storageObjectRevision: int | None = Field(default=None, ge=1)
    requestedFields: None = None


class MediaVariantJobInputBase(JobInputEnvelope):
    mediaAssetId: UUID
    expectedMediaRevision: int = Field(ge=1)
    storageObjectRevision: int = Field(ge=1)
    variantId: UUID
    generationSpecHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    preset: str = Field(min_length=1, max_length=100)


class ProxyGenerationJobInput(MediaVariantJobInputBase):
    jobType: Literal["proxy_generation"]


class AudioExtractionJobInput(MediaVariantJobInputBase):
    jobType: Literal["audio_extraction"]


class ThumbnailGenerationJobInput(MediaVariantJobInputBase):
    jobType: Literal["thumbnail_generation"]


class WaveformGenerationJobInput(MediaVariantJobInputBase):
    jobType: Literal["waveform_generation"]


class GenericJobInput(JobInputEnvelope):
    jobType: Literal[
        "transcript_analysis",
        "silence_analysis",
        "highlight_analysis",
    ]
    mediaAssetId: UUID | None = None
    clipProjectId: str | None = None


TypedJobInput = Annotated[
    Union[
        TranscriptionJobInput,
        ClipExportJobInput,
        ProjectConversionJobInput,
        ProjectDerivationJobInput,
        MediaProbeJobInput,
        ProxyGenerationJobInput,
        AudioExtractionJobInput,
        ThumbnailGenerationJobInput,
        WaveformGenerationJobInput,
        GenericJobInput,
    ],
    Field(discriminator="jobType"),
]
JOB_INPUT_ADAPTER = TypeAdapter(TypedJobInput)


def validate_job_input(value: dict[str, Any]) -> dict[str, Any]:
    return JOB_INPUT_ADAPTER.validate_python(value).model_dump(
        mode="json", by_alias=True
    )

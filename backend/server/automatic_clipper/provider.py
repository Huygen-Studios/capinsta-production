from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

from pydantic import TypeAdapter, ValidationError

from server.clipping_jobs.errors import ProcessingJobFailure

from .contracts import ViralCandidateProposalV1

_PROPOSALS = TypeAdapter(list[ViralCandidateProposalV1])

SYSTEM_PROMPT = """You select self-contained short-video moments from timestamped transcript excerpts.
Return only a JSON object with key "candidates". Each candidate must contain sourceStartMs,
sourceEndMs, title, hookText, supportingEmojis (0-2), scoreBreakdown with hookStrength,
clarity, payoff, emotion, novelty (each 0-20), and reason. Select at most 12 proposals.
Prefer 20-90 seconds, a strong opening, understandable context, and a clear payoff.
Never fabricate claims beyond the supplied transcript. Scores are editorial estimates,
not guarantees of virality."""


@dataclass(frozen=True)
class ProviderProposals:
    name: str
    model: str | None
    request_id: str | None
    proposals: list[ViralCandidateProposalV1]
    used_fallback: bool = False


def bounded_transcript_payload(document: dict[str, Any], maximum_chars: int) -> str:
    segments = []
    used = 0
    for segment in document.get("segments") or []:
        item = {
            "id": segment.get("id"),
            "startMs": segment.get("startMs"),
            "endMs": segment.get("endMs"),
            "text": str(segment.get("text") or "")[:500],
            "confidence": segment.get("confidence"),
            "language": segment.get("language"),
            "speakerId": segment.get("speakerId"),
        }
        encoded = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if used + len(encoded) > maximum_chars:
            break
        used += len(encoded)
        segments.append(item)
    return json.dumps(
        {
            "durationMs": document.get("durationMs"),
            "detectedLanguages": document.get("detectedLanguages") or [],
            "segments": segments,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


class ExistingLlmCandidateProvider:
    """Uses the existing Groq/LLM credential convention; no new router or key."""

    def __init__(self, *, timeout_seconds: int, maximum_output_bytes: int) -> None:
        self.timeout_seconds = timeout_seconds
        self.maximum_output_bytes = maximum_output_bytes

    async def propose(self, transcript_payload: str) -> ProviderProposals:
        api_key = (
            os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY") or ""
        ).strip()
        model = os.getenv(
            "VIRAL_CANDIDATE_LLM_MODEL", "llama-3.3-70b-versatile"
        ).strip()
        if not api_key:
            return ProviderProposals(
                name="deterministic",
                model=None,
                request_id=None,
                proposals=[],
                used_fallback=True,
            )

        def request():
            from groq import Groq

            client = Groq(api_key=api_key, timeout=self.timeout_seconds)
            return client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": transcript_payload},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )

        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(request), timeout=self.timeout_seconds + 2
            )
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise ProcessingJobFailure(
                "candidate_provider_timeout",
                "Candidate generation provider timed out",
                retryable=True,
            ) from exc
        except Exception as exc:
            raise ProcessingJobFailure(
                "candidate_provider_unavailable",
                "Candidate generation provider is temporarily unavailable",
                retryable=True,
            ) from exc
        content = str(response.choices[0].message.content or "")
        if len(content.encode("utf-8")) > self.maximum_output_bytes:
            raise ProcessingJobFailure(
                "candidate_provider_output_too_large",
                "Candidate provider output exceeded its limit",
                retryable=False,
            )
        try:
            decoded = json.loads(content)
            proposals = _PROPOSALS.validate_python(decoded.get("candidates"))
        except (json.JSONDecodeError, AttributeError, ValidationError) as exc:
            raise ProcessingJobFailure(
                "candidate_provider_output_invalid",
                "Candidate provider returned invalid structured output",
                retryable=False,
            ) from exc
        return ProviderProposals(
            name="groq",
            model=model,
            request_id=str(getattr(response, "id", "") or "") or None,
            proposals=proposals,
        )


__all__ = [
    "ExistingLlmCandidateProvider",
    "ProviderProposals",
    "bounded_transcript_payload",
]

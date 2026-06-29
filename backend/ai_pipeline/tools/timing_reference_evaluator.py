from __future__ import annotations

import json
import difflib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ai_pipeline.pipeline_config import resolve_pipeline_config_with_sources

HARD_BOUNDARY_GUARD_SECONDS = 0.12
NEXT_CUE_EARLY_GUARD_SECONDS = 0.20
NEXT_CUE_LATE_GUARD_SECONDS = 0.25
LOCAL_MATCH_WINDOW_SECONDS = 1.50


@dataclass(frozen=True)
class Cue:
    index: int
    start: float
    end: float
    text: str
    tokens: list[str]


def normalize_token(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    chars: list[str] = []
    for char in normalized:
        category = unicodedata.category(char)
        if category[0] in {"L", "M", "N"}:
            chars.append(char)
    return "".join(chars)


def tokenize_text(value: str) -> list[str]:
    return [token for token in (normalize_token(part) for part in re.split(r"\s+", value.strip())) if token]


def _tokens_equivalent(left: str, right: str) -> bool:
    if left == right:
        return True
    if not left or not right:
        return False
    shorter = min(len(left), len(right))
    if shorter < 4 or left[0] != right[0]:
        return False
    if abs(len(left) - len(right)) <= 1 and difflib.SequenceMatcher(a=left, b=right, autojunk=False).ratio() >= 0.84:
        return True
    return shorter >= 5 and (left.startswith(right) or right.startswith(left))


def _compound_tokens_equivalent(tokens: list[str], word: str) -> bool:
    if len(tokens) < 2 or not word:
        return False
    joined = "".join(tokens)
    if joined == word:
        return True
    if len(joined) < 6 or joined[0] != word[0]:
        return False
    return difflib.SequenceMatcher(a=joined, b=word, autojunk=False).ratio() >= 0.90


def _parse_time(value: str) -> float:
    match = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)", value.strip())
    if not match:
        raise ValueError(f"invalid_srt_time:{value}")
    hours, minutes, seconds, millis = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis[:3].ljust(3, "0")) / 1000


def parse_srt(path: str | Path) -> list[Cue]:
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip())
    cues: list[Cue] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        time_line_index = next((idx for idx, line in enumerate(lines) if "-->" in line), None)
        if time_line_index is None:
            continue
        start_raw, end_raw = [part.strip().split()[0] for part in lines[time_line_index].split("-->", 1)]
        cue_text = " ".join(lines[time_line_index + 1 :]).strip()
        cues.append(Cue(index=len(cues), start=_parse_time(start_raw), end=_parse_time(end_raw), text=cue_text, tokens=tokenize_text(cue_text)))
    return cues


def flatten_pipeline_words(transcript_or_segments: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments = transcript_or_segments.get("segments") if isinstance(transcript_or_segments, dict) else transcript_or_segments
    words: list[dict[str, Any]] = []
    for segment_index, segment in enumerate(segments or []):
        for word_index, raw_word in enumerate(segment.get("words") or []):
            word = dict(raw_word)
            displayed = str(word.get("displayedWord") or word.get("displayedText") or word.get("word") or "").strip()
            spoken = str(word.get("spokenWord") or word.get("originalWord") or word.get("word") or displayed).strip()
            word["spokenWord"] = spoken
            word["displayedWord"] = displayed
            word["word"] = displayed
            word["segmentIndex"] = segment_index
            word["wordIndex"] = word_index
            word["captionBlockId"] = segment.get("id") or f"caption-{segment_index}"
            word.setdefault("alignmentGroupId", segment.get("alignmentGroupId"))
            word.setdefault("speakerId", segment.get("speakerId"))
            word.setdefault("turnId", segment.get("turnId"))
            words.append(word)
    words.sort(key=lambda item: (float(item.get("start") or 0), float(item.get("end") or 0), item.get("segmentIndex", 0), item.get("wordIndex", 0)))
    return words


def renderer_manifest_from_segments(segments: list[dict[str, Any]]) -> dict[str, Any]:
    groups: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        words = [dict(word) for word in segment.get("words") or []]
        alignment_groups = sorted({str(word.get("alignmentGroupId")) for word in words if word.get("alignmentGroupId") is not None})
        speaker_ids = sorted({str(word.get("speakerId")) for word in words if word.get("speakerId") is not None})
        turn_ids = sorted({str(word.get("turnId")) for word in words if word.get("turnId") is not None})
        groups.append(
            {
                "index": index,
                "id": segment.get("id"),
                "text": segment.get("text") or " ".join(str(word.get("displayedWord") or word.get("word") or "").strip() for word in words).strip(),
                "start": segment.get("start"),
                "end": segment.get("end"),
                "wordCount": len(words),
                "words": [
                    {
                        "spokenWord": word.get("spokenWord") or word.get("originalWord") or word.get("word"),
                        "displayedWord": word.get("displayedWord") or word.get("word"),
                        "word": word.get("displayedWord") or word.get("word"),
                        "start": word.get("start"),
                        "end": word.get("end"),
                        "alignmentGroupId": word.get("alignmentGroupId"),
                        "speakerId": word.get("speakerId"),
                        "turnId": word.get("turnId"),
                    }
                    for word in words
                ],
                "alignmentGroupIds": alignment_groups,
                "speakerIds": speaker_ids,
                "turnIds": turn_ids,
                "crossesHardAlignmentBoundary": len(alignment_groups) > 1 or len(speaker_ids) > 1 or len(turn_ids) > 1,
            }
        )
    return {"captionGroups": groups}


def _word_midpoint(word: dict[str, Any]) -> float:
    return (float(word.get("start") or 0.0) + float(word.get("end") or 0.0)) / 2


def match_cue_tokens(cues: list[Cue], words: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    normalized_words = [normalize_token(word.get("displayedWord") or word.get("word")) for word in words]
    used_indexes: set[int] = set()
    matches: dict[int, list[dict[str, Any]]] = {}
    for cue in cues:
        cue_matches: list[dict[str, Any]] = []
        search_start = 0
        window_start = cue.start - LOCAL_MATCH_WINDOW_SECONDS
        window_end = cue.end + LOCAL_MATCH_WINDOW_SECONDS
        token_index = 0
        while token_index < len(cue.tokens):
            token = cue.tokens[token_index]
            matched = False
            for word_index in range(search_start, len(words)):
                if word_index in used_indexes:
                    continue
                if not _tokens_equivalent(normalized_words[word_index], token):
                    continue
                midpoint = _word_midpoint(words[word_index])
                if midpoint < window_start or midpoint > window_end:
                    continue
                used_indexes.add(word_index)
                cue_matches.append(words[word_index])
                search_start = word_index + 1
                token_index += 1
                matched = True
                break
            if matched:
                continue

            compound_matched = False
            for token_span in (3, 2):
                if token_index + token_span > len(cue.tokens):
                    continue
                token_slice = cue.tokens[token_index : token_index + token_span]
                for word_index in range(search_start, len(words)):
                    if word_index in used_indexes:
                        continue
                    if not _compound_tokens_equivalent(token_slice, normalized_words[word_index]):
                        continue
                    midpoint = _word_midpoint(words[word_index])
                    if midpoint < window_start or midpoint > window_end:
                        continue
                    used_indexes.add(word_index)
                    cue_matches.append(words[word_index])
                    search_start = word_index + 1
                    token_index += token_span
                    compound_matched = True
                    break
                if compound_matched:
                    break
            if not compound_matched:
                token_index += 1
        matches[cue.index] = cue_matches
    return matches


def compare_to_reference(
    cues: list[Cue],
    pipeline_words: list[dict[str, Any]],
    renderer_manifest: dict[str, Any],
    resolved_config: dict[str, Any],
) -> dict[str, Any]:
    resolved = resolved_config.get("resolved") or {}
    caption_cfg = resolved.get("captionChunking") or {}
    alignment_cfg = resolved.get("alignment") or {}
    pause_threshold = float(caption_cfg.get("pauseSplitThresholdSeconds") or 0.25)
    max_words = int(caption_cfg.get("maxWords") or 3)
    cue_matches = match_cue_tokens(cues, pipeline_words)
    failures: list[dict[str, Any]] = []
    boundaries: list[dict[str, Any]] = []
    hard_boundary_after_cue_indexes = {
        previous.index
        for previous, current in zip(cues, cues[1:])
        if current.start - previous.end >= pause_threshold
    }

    def crosses_hard_reference_boundary(represented_cues: set[int]) -> bool:
        if len(represented_cues) <= 1:
            return False
        ordered = sorted(represented_cues)
        for left, right in zip(ordered, ordered[1:]):
            if any(index in hard_boundary_after_cue_indexes for index in range(left, right)):
                return True
        return False

    def word_group_ids(words: list[dict[str, Any]]) -> set[str]:
        return {
            str(word.get("alignmentGroupId"))
            for word in words
            if word.get("alignmentGroupId") is not None and str(word.get("alignmentGroupId")).strip()
        }

    def has_production_split(left_words: list[dict[str, Any]], right_words: list[dict[str, Any]]) -> bool:
        left_groups = word_group_ids(left_words)
        right_groups = word_group_ids(right_words)
        if not left_groups or not right_groups:
            # Keep evaluator conservative for sparse synthetic data.
            return True
        return left_groups.isdisjoint(right_groups)

    caption_groups = renderer_manifest.get("captionGroups") or []
    word_to_cue: dict[tuple[int, int], int] = {}
    for cue_index, matched_words in cue_matches.items():
        for word in matched_words:
            word_to_cue[(int(word.get("segmentIndex", -1)), int(word.get("wordIndex", -1)))] = cue_index

    for group in caption_groups:
        if int(group.get("wordCount") or 0) > max_words:
            failures.append({"type": "caption_max_words_exceeded", "caption": group.get("text"), "wordCount": group.get("wordCount"), "maxWords": max_words})
        represented_cues: set[int] = set()
        for word in group.get("words") or []:
            for candidate in pipeline_words:
                if candidate.get("captionBlockId") == group.get("id") and candidate.get("start") == word.get("start") and candidate.get("end") == word.get("end"):
                    cue_index = word_to_cue.get((int(candidate.get("segmentIndex", -1)), int(candidate.get("wordIndex", -1))))
                    if cue_index is not None:
                        represented_cues.add(cue_index)
                    break
        if crosses_hard_reference_boundary(represented_cues):
            group_words = [
                candidate
                for candidate in pipeline_words
                if candidate.get("captionBlockId") == group.get("id")
            ]
            represented_groups = word_group_ids(group_words)
            if len(represented_groups) > 1:
                failures.append(
                    {
                        "type": "caption_crosses_hard_reference_boundary",
                        "caption": group.get("text"),
                        "cueIndexes": sorted(represented_cues),
                    }
                )

    for previous, current in zip(cues, cues[1:]):
        gap = current.start - previous.end
        if gap < pause_threshold:
            continue
        previous_words = cue_matches.get(previous.index, [])
        current_words = cue_matches.get(current.index, [])
        production_split = has_production_split(previous_words, current_words)
        previous_spill = [word for word in previous_words if float(word.get("end") or 0) > current.start + HARD_BOUNDARY_GUARD_SECONDS]
        next_early = [word for word in current_words if float(word.get("start") or 0) < current.start - NEXT_CUE_EARLY_GUARD_SECONDS]
        next_late = current_words[:1] if current_words and float(current_words[0].get("start") or 0) > current.end + NEXT_CUE_LATE_GUARD_SECONDS else []
        duration = max((max(float(word.get("end") or 0) for word in current_words) - min(float(word.get("start") or 0) for word in current_words)) if current_words else 0.0, 0.0)
        boundary = {
            "previousCueIndex": previous.index,
            "nextCueIndex": current.index,
            "previousCue": {"start": previous.start, "end": previous.end, "text": previous.text},
            "nextCue": {"start": current.start, "end": current.end, "text": current.text},
            "gapSeconds": round(gap, 3),
            "previousSpillWords": previous_spill,
            "nextEarlyWords": next_early,
            "nextLateWords": next_late,
            "nextCueVisibleDuration": round(duration, 3),
            "previousMatchedWordCount": len(previous_words),
            "nextMatchedWordCount": len(current_words),
            "productionStructuralSplit": production_split,
        }
        boundaries.append(boundary)
        if previous_spill and production_split:
            failures.append({"type": "previous_cue_spill", "boundary": f"{previous.end:.3f}->{current.start:.3f}", "words": previous_spill})
        elif previous_spill:
            boundary["previousSpillReferenceOnly"] = True
        if next_early and production_split:
            failures.append({"type": "next_cue_too_early", "boundary": f"{previous.end:.3f}->{current.start:.3f}", "words": next_early})
        elif next_early:
            boundary["nextEarlyReferenceOnly"] = True
        if next_late:
            failures.append({"type": "next_cue_too_late", "boundary": f"{previous.end:.3f}->{current.start:.3f}", "words": next_late})
        if duration <= 0:
            if current_words:
                failures.append({"type": "next_cue_no_positive_visible_duration", "boundary": f"{previous.end:.3f}->{current.start:.3f}"})
            else:
                boundary["nextCueUnmatchedReference"] = True

    if bool(alignment_cfg.get("allowStableTsOrderFallback")):
        source = ((resolved_config.get("sources") or {}).get("alignment") or {}).get("allowStableTsOrderFallback")
        failures.append({"type": "stable_ts_order_fallback_enabled", "source": source})

    return {
        "passed": not failures,
        "failureCount": len(failures),
        "failures": failures,
        "hardBoundaryGuardSeconds": HARD_BOUNDARY_GUARD_SECONDS,
        "pauseSplitSeconds": pause_threshold,
        "maxCaptionWords": max_words,
        "boundaries": boundaries,
        "cueMatchSummary": [
            {"cueIndex": cue.index, "text": cue.text, "tokenCount": len(cue.tokens), "matchedWordCount": len(cue_matches.get(cue.index, []))}
            for cue in cues
        ],
    }


def write_markdown_report(path: str | Path, comparison: dict[str, Any], resolved_config: dict[str, Any]) -> None:
    lines = [
        "# Timing Reference Comparison",
        "",
        f"Result: {'PASS' if comparison.get('passed') else 'FAIL'}",
        f"Failures: {comparison.get('failureCount')}",
        f"Pause split seconds: {comparison.get('pauseSplitSeconds')}",
        f"Hard boundary guard seconds: {comparison.get('hardBoundaryGuardSeconds')}",
        "",
        "## Effective Configuration",
        "",
        f"- Timing policy: {(resolved_config.get('resolved') or {}).get('timingSourcePolicy')}",
        f"- Stable-ts model: {((resolved_config.get('resolved') or {}).get('alignment') or {}).get('stableTsModel')}",
        f"- Allow stable-ts order fallback: {((resolved_config.get('resolved') or {}).get('alignment') or {}).get('allowStableTsOrderFallback')}",
        f"- Caption max words: {((resolved_config.get('resolved') or {}).get('captionChunking') or {}).get('maxWords')}",
        "",
        "## Hard Boundaries",
    ]
    for boundary in comparison.get("boundaries") or []:
        lines.extend(
            [
                "",
                f"### Boundary: {boundary['previousCue']['end']:.3f} -> {boundary['nextCue']['start']:.3f}",
                "",
                f"Expected previous cue: {boundary['previousCue']['text']}",
                f"Expected next cue: {boundary['nextCue']['text']}",
                f"Previous matched words: {boundary['previousMatchedWordCount']}",
                f"Next matched words: {boundary['nextMatchedWordCount']}",
                f"Next cue visible duration: {boundary['nextCueVisibleDuration']}",
                f"Previous spill words: {len(boundary['previousSpillWords'])}",
                f"Next early words: {len(boundary['nextEarlyWords'])}",
                f"Next late words: {len(boundary['nextLateWords'])}",
            ]
        )
    if comparison.get("failures"):
        lines.extend(["", "## Failures"])
        for failure in comparison["failures"]:
            lines.append(f"- `{failure.get('type')}`: {failure}")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")

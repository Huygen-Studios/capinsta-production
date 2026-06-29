import json
import logging
import os
import re
from typing import Any

from .language_modes import (
    containsDevanagariScript,
    containsTeluguScript,
    normalize_audio_language,
    normalize_caption_output,
    normalize_word_token_with_metadata,
    romanizeHindiText,
    romanizeTeluguText,
)
from .transcriber import GEMINI_MODEL, _extract_json_object, _gemini_api_key, _gemini_client, _sanitize_provider_message

logger = logging.getLogger(__name__)
WORD_RE = re.compile(r"\S+")


class OutputTransformationError(RuntimeError):
    pass


def _word_text(word: dict[str, Any]) -> str:
    return str(word.get("displayedWord") or word.get("word") or word.get("text") or "").strip()


def _segment_words_for_text(text: str, start: float, end: float, provider: str, timing_source: str) -> list[dict[str, Any]]:
    tokens = [match.group(0) for match in WORD_RE.finditer(text or "")]
    if not tokens:
        return []
    duration = max(0.001, end - start)
    step = duration / len(tokens)
    words: list[dict[str, Any]] = []
    cursor = start
    for index, token in enumerate(tokens):
        word_start = round(cursor, 3)
        word_end = round(end if index == len(tokens) - 1 else min(end, cursor + step), 3)
        if word_end <= word_start:
            word_end = round(min(end, word_start + 0.001), 3)
        words.append(
            {
                "word": token,
                "start": word_start,
                "end": word_end,
                "provider": provider,
                "timing_source": timing_source,
                "timingSource": timing_source,
                "timingSourceDetail": timing_source,
                "timingNeedsReview": timing_source == "translated_derived",
                "timingReviewRequired": timing_source == "translated_derived",
            }
        )
        cursor = word_end
    return words


def _copy_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**segment, "words": [dict(word) for word in segment.get("words") or []]} for segment in segments]


def _script_convert_text(text: str, source_language: str, output_language: str) -> str:
    try:
        from indic_transliteration import sanscript
        from indic_transliteration.sanscript import transliterate
    except Exception as exc:
        raise OutputTransformationError("Script conversion requires indic-transliteration.") from exc

    if source_language == "telgish" and output_language == "telugu":
        return transliterate(text, sanscript.ITRANS, sanscript.TELUGU)
    if source_language == "hinglish" and output_language == "hindi":
        return transliterate(text, sanscript.ITRANS, sanscript.DEVANAGARI)
    return text


def _transliterate_text(text: str, source_language: str, output_language: str) -> str:
    if source_language == "telugu" and output_language == "telgish":
        return romanizeTeluguText(text)
    if source_language == "hindi" and output_language == "hinglish":
        return romanizeHindiText(text)
    if output_language == "telgish" and containsTeluguScript(text):
        return romanizeTeluguText(text)
    if output_language == "hinglish" and containsDevanagariScript(text):
        return romanizeHindiText(text)
    return text


def transformation_kind(source_language: str, output_language: str) -> str:
    source = normalize_audio_language(source_language)
    output = normalize_caption_output(output_language)
    if output == "original" or output == source:
        return "none"
    if (source, output) in {("telugu", "telgish"), ("hindi", "hinglish")}:
        return "transliteration"
    if (source, output) in {("telgish", "telugu"), ("hinglish", "hindi")}:
        return "script_conversion"
    return "translation"


def _transform_words_one_to_one(
    source_words: list[dict[str, Any]],
    transformed_text: str,
    source_language: str,
    output_language: str,
    kind: str,
) -> list[dict[str, Any]] | None:
    tokens = [match.group(0) for match in WORD_RE.finditer(transformed_text or "")]
    if len(tokens) != len(source_words):
        return None
    transformed_words: list[dict[str, Any]] = []
    for source_word, token in zip(source_words, tokens):
        transformed = dict(source_word)
        transformed["originalWord"] = transformed.get("originalWord") or _word_text(source_word)
        transformed["originalText"] = transformed["originalWord"]
        transformed["word"] = token
        transformed["displayedWord"] = token
        transformed["displayText"] = token
        transformed["outputLanguage"] = output_language
        transformed["sourceLanguage"] = source_language
        transformed["transformation"] = kind
        word_meta = normalize_word_token_with_metadata(_word_text(source_word), output_language)
        if word_meta.get("normalizationRule") and word_meta.get("word") == token:
            transformed["normalizationRule"] = word_meta["normalizationRule"]
            transformed["wordNormalization"] = dict(word_meta.get("wordNormalization") or {
                "originalWord": transformed["originalWord"],
                "displayedWord": token,
                "normalizationRule": word_meta["normalizationRule"],
            })
        transformed_words.append(transformed)
    return transformed_words


def _translate_text(text: str, source_language: str, output_language: str) -> str:
    api_key = _gemini_api_key()
    if not api_key:
        raise OutputTransformationError("Translation requires GEMINI_API_KEY.")
    prompt = (
        "Translate this caption segment for a video editor. "
        f"Source language: {source_language}. Output language: {output_language}. "
        "For Hinglish output, use readable Roman Hindi/Hindi-English. "
        "For Telgish output, use readable Roman Telugu/Telugu-English. "
        "Return only JSON: {\"text\":\"translated caption\"}.\n\n"
        f"Caption: {text}"
    )
    client = _gemini_client(api_key)
    try:
        interaction = client.interactions.create(
            model=os.getenv("GEMINI_TRANSLATION_MODEL", GEMINI_MODEL),
            input=prompt,
            response_format={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
            timeout=60,
        )
        translated = _extract_json_object(str(getattr(interaction, "output_text", "") or "")).get("text", "").strip()
    except Exception as exc:
        logger.warning("translation_provider_failed provider=gemini message=%s", _sanitize_provider_message(str(exc)) or "-")
        raise OutputTransformationError("Translation provider failed or returned malformed JSON.") from exc
    if not translated:
        raise OutputTransformationError("Translation provider returned empty text.")
    return translated


def transform_segments_for_output(
    segments: list[dict[str, Any]],
    *,
    source_language: str,
    output_language: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = normalize_audio_language(source_language)
    output = normalize_caption_output(output_language)
    kind = transformation_kind(source, output)
    if kind == "none":
        return _copy_segments(segments), {
            "sourceLanguage": source,
            "outputLanguage": output,
            "transformation": "none",
        }

    transformed_segments: list[dict[str, Any]] = []
    for segment in segments:
        source_text = str(segment.get("text") or "")
        source_words = [dict(word) for word in segment.get("words") or []]
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or start + 0.001)
        if kind == "translation":
            display_text = _translate_text(source_text, source, output)
            words = _segment_words_for_text(display_text, start, end, "translation", "translated_derived")
        elif kind == "script_conversion":
            display_text = _script_convert_text(source_text, source, output)
            words = _transform_words_one_to_one(source_words, display_text, source, output, kind)
            if words is None:
                words = _segment_words_for_text(display_text, start, end, "script_conversion", "derived")
        else:
            display_text = _transliterate_text(source_text, source, output)
            words = _transform_words_one_to_one(source_words, display_text, source, output, kind)
            if words is None:
                words = _segment_words_for_text(display_text, start, end, "transliteration", "derived")

        transformed_segments.append(
            {
                **segment,
                "originalText": source_text,
                "displayText": display_text,
                "text": display_text,
                "sourceLanguage": source,
                "outputLanguage": output,
                "transformation": kind,
                "words": words,
            }
        )

    return transformed_segments, {
        "sourceLanguage": source,
        "outputLanguage": output,
        "transformation": kind,
    }

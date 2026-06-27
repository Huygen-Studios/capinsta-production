import re
import unicodedata
from typing import Iterable, Literal, TypedDict

try:
    from indic_transliteration import sanscript
    from indic_transliteration.sanscript import transliterate as _indic_transliterate
except Exception:  # pragma: no cover - dependency fallback for partial installs
    sanscript = None
    _indic_transliterate = None


CaptionLanguageMode = Literal["auto", "english", "hindi", "telugu", "hinglish", "telgish", "auto_mixed_indian"]
CaptionOutputLanguage = Literal["original", "english", "hindi", "telugu", "hinglish", "telgish"]
LanguageHint = Literal["english", "hindi", "telugu", "unknown"]

SUPPORTED_LANGUAGE_MODES: tuple[CaptionLanguageMode, ...] = (
    "auto",
    "english",
    "hindi",
    "telugu",
    "hinglish",
    "telgish",
    "auto_mixed_indian",
)
SUPPORTED_AUDIO_LANGUAGES: tuple[CaptionLanguageMode, ...] = (
    "auto",
    "english",
    "hindi",
    "telugu",
    "hinglish",
    "telgish",
)
SUPPORTED_CAPTION_OUTPUTS: tuple[CaptionOutputLanguage, ...] = (
    "original",
    "english",
    "hindi",
    "telugu",
    "hinglish",
    "telgish",
)

CODE_MIXED_LANGUAGE_MODES = {"hinglish", "telgish", "auto", "auto_mixed_indian"}

_LANGUAGE_ALIASES = {
    "": "auto",
    "auto": "auto",
    "automixed": "auto",
    "autoindian": "auto",
    "mixed": "auto",
    "mixedindian": "auto",
    "auto_mixed": "auto",
    "auto_mixed_indian": "auto_mixed_indian",
    "en": "english",
    "eng": "english",
    "english": "english",
    "hi": "hindi",
    "hindi": "hindi",
    "hinglish": "hinglish",
    "te": "telugu",
    "telugu": "telugu",
    "telgish": "telgish",
    "teluglish": "telgish",
    "tenglish": "telgish",
    "te_en": "telgish",
    "te-en": "telgish",
}

TELUGU_CAPABLE_PROVIDER_ERROR = (
    "Auto Mixed Indian and Telgish modes require a configured transcription provider. "
    "Please set SARVAM_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY."
)
TELGISH_PROVIDER_ERROR = TELUGU_CAPABLE_PROVIDER_ERROR

TELUGU_RE = re.compile(r"[\u0C00-\u0C7F]")
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
NATIVE_INDIAN_RE = re.compile(r"[\u0900-\u097F\u0C00-\u0C7F]")
ASCII_WORD_RE = re.compile(r"[A-Za-z]")
LIGHT_PUNCT_RE = re.compile(r"[^\w\s\u0900-\u097F\u0C00-\u0C7F'-]")
SPACE_RE = re.compile(r"\s+")
TOKEN_RE = re.compile(r"\s+|[^\s]+")


class NormalizedWordToken(TypedDict, total=False):
    word: str
    originalWord: str
    languageHint: LanguageHint
    romanized: bool


TELGISH_CANONICAL = {
    "sait": "site",
    "saite": "site",
    "kaal": "call",
    "kal": "call",
    "klaiyant": "client",
    "klayimt": "client",
    "clientu": "client",
    "bajet": "budget",
    "badjet": "budget",
    "phonu": "phone",
    "veedio": "video",
    "aaphis": "office",
    "meeeting": "meeting",
    "mim": "meem",
    "mimu": "meemu",
    "miku": "meeku",
    "nEnu": "nenu",
    "maatlaadaanu": "maatladanu",
    "mataladanu": "maatladanu",
    "cheppaali": "cheppali",
    "cheppaanu": "cheppanu",
    "chaalaa": "chala",
    "baagundhi": "baagundi",
    "tO": "tho",
    "to": "tho",
    "ramdi": "randi",
    "emta": "enta",
    "amdukane": "andukane",
    "kimda": "kinda",
    "umdi": "undi",
    "kottimdaam": "kottindaam",
    "aagamdi": "aagandi",
}

HINGLISH_CANONICAL = {
    "maim": "main",
    "mai": "main",
    "kala": "kal",
    "baata": "baat",
    "bata": "baat",
    "kee": "ki",
    "kI": "ki",
    "haim": "hain",
    "nahiim": "nahi",
    "nahee": "nahi",
    "achchha": "achha",
}

COMMON_CANONICAL = {
    "veediyo": "video",
    "veedio": "video",
    "biznes": "business",
    "preemiyam": "premium",
    "reeel": "reel",
}


def normalize_language_mode(value: str | None) -> CaptionLanguageMode:
    mode = (value or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    compact = mode.replace("_", "")
    normalized = _LANGUAGE_ALIASES.get(mode) or _LANGUAGE_ALIASES.get(compact)
    if normalized not in SUPPORTED_LANGUAGE_MODES:
        allowed = ", ".join(SUPPORTED_LANGUAGE_MODES)
        raise ValueError(f"Unsupported language mode '{value}'. Use one of: {allowed}.")
    return normalized  # type: ignore[return-value]


def normalize_audio_language(value: str | None) -> CaptionLanguageMode:
    normalized = normalize_language_mode(value)
    if normalized == "auto_mixed_indian":
        normalized = "auto"
    if normalized not in SUPPORTED_AUDIO_LANGUAGES:
        allowed = ", ".join(SUPPORTED_AUDIO_LANGUAGES)
        raise ValueError(f"Unsupported audio language '{value}'. Use one of: {allowed}.")
    return normalized


def normalize_caption_output(value: str | None) -> CaptionOutputLanguage:
    raw = (value or "original").strip().lower().replace("-", "_").replace(" ", "_")
    if raw in {"", "original", "keep_original", "same", "source", "auto"}:
        return "original"
    normalized = _LANGUAGE_ALIASES.get(raw) or _LANGUAGE_ALIASES.get(raw.replace("_", ""))
    if normalized == "auto":
        return "original"
    if normalized not in SUPPORTED_CAPTION_OUTPUTS:
        allowed = ", ".join(SUPPORTED_CAPTION_OUTPUTS)
        raise ValueError(f"Unsupported caption output '{value}'. Use one of: {allowed}.")
    return normalized  # type: ignore[return-value]


def transcription_language_mode(audio_language: str | None) -> CaptionLanguageMode:
    normalized = normalize_audio_language(audio_language)
    if normalized == "auto":
        return "auto_mixed_indian"
    return normalized


def containsTeluguScript(text: str | None) -> bool:
    return bool(text and TELUGU_RE.search(text))


def containsDevanagariScript(text: str | None) -> bool:
    return bool(text and DEVANAGARI_RE.search(text))


def containsNativeIndianScript(text: str | None) -> bool:
    return bool(text and NATIVE_INDIAN_RE.search(text))


contains_telugu = containsTeluguScript


def _fallback_romanize(text: str) -> str:
    # Fallback is intentionally conservative; production installs use
    # indic-transliteration for broad Hindi/Telugu coverage.
    return text


def _simplify_itrans(text: str) -> str:
    replacements = (
        ("RRi", "ri"),
        ("RRI", "ree"),
        ("LLi", "li"),
        ("LLI", "lee"),
        ("~N", "n"),
        ("JN", "ny"),
        ("Ch", "ch"),
        ("Sh", "sh"),
        ("A", "aa"),
        ("I", "ee"),
        ("U", "oo"),
        ("M", "m"),
        ("H", "h"),
        ("N", "n"),
        ("T", "t"),
        ("D", "d"),
        ("L", "l"),
    )
    result = text
    for old, new in replacements:
        result = result.replace(old, new)
    result = unicodedata.normalize("NFKD", result)
    result = "".join(ch for ch in result if not unicodedata.combining(ch))
    return result


def _romanize_with_indic(text: str, source: str) -> str:
    if not _indic_transliterate or not sanscript:
        return _fallback_romanize(text)
    return _simplify_itrans(_indic_transliterate(text, source, sanscript.ITRANS))


def romanizeTeluguText(text: str) -> str:
    if not containsTeluguScript(text):
        return text
    source = sanscript.TELUGU if sanscript else ""
    return _romanize_with_indic(text, source)


def romanizeHindiText(text: str) -> str:
    if not containsDevanagariScript(text):
        return text
    source = sanscript.DEVANAGARI if sanscript else ""
    return _romanize_with_indic(text, source)


def _token_language_hint(token: str) -> LanguageHint:
    if containsTeluguScript(token):
        return "telugu"
    if containsDevanagariScript(token):
        return "hindi"
    if ASCII_WORD_RE.search(token):
        return "english"
    return "unknown"


def _romanize_token(token: str) -> str:
    if containsTeluguScript(token):
        return romanizeTeluguText(token)
    if containsDevanagariScript(token):
        return romanizeHindiText(token)
    return token


def romanizeMixedIndianText(text: str) -> str:
    parts = []
    for match in TOKEN_RE.finditer(text or ""):
        token = match.group(0)
        if token.isspace():
            parts.append(token)
        else:
            parts.append(_romanize_token(token))
    return "".join(parts)


def romanize_if_needed(text: str, language_mode: str) -> str:
    if language_mode in CODE_MIXED_LANGUAGE_MODES:
        return romanizeMixedIndianText(text)
    return text


def _canonicalize_word(word: str, language_mode: str) -> str:
    lookup = word.lower()
    if language_mode in {"telgish", "auto_mixed_indian"}:
        lookup = TELGISH_CANONICAL.get(lookup, lookup)
    if language_mode in {"hinglish", "auto_mixed_indian"}:
        lookup = HINGLISH_CANONICAL.get(lookup, lookup)
    lookup = COMMON_CANONICAL.get(lookup, lookup)
    return lookup


def normalizeCodeMixedText(text: str, language_mode: str) -> str:
    return normalize_caption_text(text, language_mode)


def normalize_caption_text(text: str, language_mode: str) -> str:
    if not text:
        return ""

    mode = normalize_language_mode(language_mode)
    normalized = romanize_if_needed(text, mode)
    normalized = LIGHT_PUNCT_RE.sub(" ", normalized)
    normalized = SPACE_RE.sub(" ", normalized).strip()
    if mode in CODE_MIXED_LANGUAGE_MODES:
        normalized = " ".join(_canonicalize_word(word, mode) for word in normalized.split())
        normalized = normalized.lower()
    return normalized


def normalize_word_token_with_metadata(word: str, language_mode: str) -> NormalizedWordToken:
    original = (word or "").strip()
    mode = normalize_language_mode(language_mode)
    language_hint = _token_language_hint(original)
    normalized = normalize_caption_text(original, mode)
    result: NormalizedWordToken = {
        "word": normalized,
        "languageHint": language_hint,
        "romanized": bool(original and normalized and original != normalized),
    }
    if result["romanized"]:
        result["originalWord"] = original
    return result


def normalize_word_token(word: str, language_mode: str) -> str:
    return normalize_word_token_with_metadata(word, language_mode).get("word", "").strip()


def final_text_requires_romanization(language_mode: str) -> bool:
    return normalize_language_mode(language_mode) in CODE_MIXED_LANGUAGE_MODES


def validate_roman_output(text: str, language_mode: str) -> None:
    if final_text_requires_romanization(language_mode) and containsNativeIndianScript(text):
        raise ValueError("Romanization failed; final captions still contain native Indian script.")


def text_from_words(words: Iterable[str]) -> str:
    return SPACE_RE.sub(" ", " ".join(w for w in words if w)).strip()

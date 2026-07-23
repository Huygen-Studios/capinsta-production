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
ScriptHint = Literal["latin", "telugu", "devanagari", "tamil", "mixed", "unknown"]

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
ROMAN_OUTPUT_LANGUAGE_MODES = {"hinglish", "telgish"}

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
TAMIL_RE = re.compile(r"[\u0B80-\u0BFF]")
NATIVE_INDIAN_RE = re.compile(r"[\u0900-\u097F\u0C00-\u0C7F]")
ASCII_WORD_RE = re.compile(r"[A-Za-z]")
SPACE_RE = re.compile(r"\s+")
TOKEN_RE = re.compile(r"\s+|[^\s]+")
LATIN_WORD_RE = re.compile(r"[A-Za-z]+(?:['-][A-Za-z]+)*")


class NormalizedWordToken(TypedDict, total=False):
    word: str
    originalWord: str
    displayedWord: str
    languageHint: LanguageHint
    scriptHint: ScriptHint
    romanized: bool
    normalizationRule: str
    wordNormalization: dict[str, str]
    suspectedScriptMismatch: bool
    scriptMismatchReason: str


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


def containsTamilScript(text: str | None) -> bool:
    return bool(text and TAMIL_RE.search(text))


def containsNativeIndianScript(text: str | None) -> bool:
    return bool(text and NATIVE_INDIAN_RE.search(text))


contains_telugu = containsTeluguScript


def _fallback_romanize(text: str) -> str:
    # Fallback is intentionally conservative; production installs use
    # indic-transliteration for broad Hindi/Telugu coverage.
    return text


def _simplify_itrans(text: str) -> str:
    # ITRANS uses M for anusvara/chandrabindu. Resolve it from the following
    # consonant class instead of globally turning every nasal into m or n.
    text = re.sub(r"M(?=[kKgG])", "ng", text)
    text = re.sub(r"M(?=[cCjJ])", "ny", text)
    text = re.sub(r"M(?=[TtDd])", "n", text)
    text = re.sub(r"M(?=[pPbB])", "m", text)
    text = re.sub(r"M(?=$|[^A-Za-z])", "n", text)
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
        ("M", "n"),
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


def _has_telugu_contextual_nasal_normalization(text: str) -> bool:
    if not containsTeluguScript(text) or not _indic_transliterate or not sanscript:
        return False
    try:
        itrans = _indic_transliterate(text, sanscript.TELUGU, sanscript.ITRANS)
    except Exception:
        return False
    return bool(re.search(r"M(?=[dDtT])", itrans))


def romanizeHindiText(text: str) -> str:
    if not containsDevanagariScript(text):
        return text
    source = sanscript.DEVANAGARI if sanscript else ""
    parts: list[str] = []
    devanagari_consonant = re.compile(r"[\u0915-\u0939\u0958-\u095F]$")
    for match in TOKEN_RE.finditer(text):
        token = match.group(0)
        if token.isspace() or not containsDevanagariScript(token):
            parts.append(token)
            continue
        romanized = _romanize_with_indic(token, source)
        # A final inherent schwa is normally silent when the source token ends
        # in a consonant. Do not touch explicit vowel signs or independent
        # vowels, and never remove long "aa".
        if devanagari_consonant.search(token) and romanized.endswith("a") and not romanized.endswith("aa"):
            romanized = romanized[:-1]
        parts.append(romanized)
    return "".join(parts)


def _token_language_hint(token: str) -> LanguageHint:
    if containsTeluguScript(token):
        return "telugu"
    if containsDevanagariScript(token):
        return "hindi"
    if ASCII_WORD_RE.search(token):
        return "english"
    return "unknown"


def _token_script_hint(token: str) -> ScriptHint:
    scripts: set[str] = set()
    if ASCII_WORD_RE.search(token):
        scripts.add("latin")
    if containsTeluguScript(token):
        scripts.add("telugu")
    if containsDevanagariScript(token):
        scripts.add("devanagari")
    if containsTamilScript(token):
        scripts.add("tamil")
    if len(scripts) > 1:
        return "mixed"
    if scripts:
        return next(iter(scripts))  # type: ignore[return-value]
    return "unknown"


def _script_mismatch_reason(script_hint: ScriptHint, mode: CaptionLanguageMode) -> str | None:
    if script_hint in {"unknown", "latin"}:
        return None
    if mode == "telugu" and script_hint != "telugu":
        return "script_not_expected_for_telugu"
    if mode == "hindi" and script_hint != "devanagari":
        return "script_not_expected_for_hindi"
    # Code-mixed modes currently support Latin output and Telugu/Devanagari
    # romanization. Other Indic scripts are diagnostic-only until a provider
    # explicitly reports them as supported for the selected language mode.
    if mode in CODE_MIXED_LANGUAGE_MODES and script_hint == "tamil":
        return "unsupported_script_for_selected_language_mode"
    return None


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
    if language_mode in ROMAN_OUTPUT_LANGUAGE_MODES:
        return romanizeMixedIndianText(text)
    return text


def _canonicalize_word(word: str, language_mode: str) -> str:
    lookup = word.casefold()
    if language_mode in {"telgish", "auto_mixed_indian"}:
        replacement = TELGISH_CANONICAL.get(lookup)
        if replacement:
            return replacement
    if language_mode in {"hinglish", "auto_mixed_indian"}:
        replacement = HINGLISH_CANONICAL.get(lookup)
        if replacement:
            return replacement
    return COMMON_CANONICAL.get(lookup, word)


def normalizeCodeMixedText(text: str, language_mode: str) -> str:
    return normalize_caption_text(text, language_mode)


def normalize_caption_text(text: str, language_mode: str) -> str:
    if not text:
        return ""

    mode = normalize_language_mode(language_mode)
    normalized = unicodedata.normalize("NFC", romanize_if_needed(text, mode))
    normalized = SPACE_RE.sub(" ", normalized).strip()
    if mode in CODE_MIXED_LANGUAGE_MODES:
        normalized = LATIN_WORD_RE.sub(
            lambda match: _canonicalize_word(match.group(0), mode),
            normalized,
        )
    return normalized


def normalize_word_token_with_metadata(word: str, language_mode: str) -> NormalizedWordToken:
    original = (word or "").strip()
    mode = normalize_language_mode(language_mode)
    language_hint = _token_language_hint(original)
    script_hint = _token_script_hint(original)
    normalized = normalize_caption_text(original, mode)
    result: NormalizedWordToken = {
        "word": normalized,
        "languageHint": language_hint,
        "scriptHint": script_hint,
        "romanized": bool(original and normalized and original != normalized),
    }
    mismatch_reason = _script_mismatch_reason(script_hint, mode)
    if mismatch_reason:
        result["suspectedScriptMismatch"] = True
        result["scriptMismatchReason"] = mismatch_reason
    if result["romanized"]:
        result["originalWord"] = original
    if _has_telugu_contextual_nasal_normalization(original):
        result["displayedWord"] = normalized
        result["normalizationRule"] = "telugu_contextual_anusvara_before_dental"
        result["wordNormalization"] = {
            "originalWord": original,
            "displayedWord": normalized,
            "normalizationRule": "telugu_contextual_anusvara_before_dental",
        }
    return result


def normalize_word_token(word: str, language_mode: str) -> str:
    return normalize_word_token_with_metadata(word, language_mode).get("word", "").strip()


def final_text_requires_romanization(language_mode: str) -> bool:
    return normalize_language_mode(language_mode) in ROMAN_OUTPUT_LANGUAGE_MODES


def validate_roman_output(text: str, language_mode: str) -> None:
    if final_text_requires_romanization(language_mode) and containsNativeIndianScript(text):
        raise ValueError("Romanization failed; final captions still contain native Indian script.")


def text_from_words(words: Iterable[str]) -> str:
    return SPACE_RE.sub(" ", " ".join(w for w in words if w)).strip()

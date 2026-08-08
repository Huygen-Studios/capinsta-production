# Sarvam Hindi and Hinglish transcription

CapInsta uses Sarvam `saaras:v3` through `/speech-to-text`.

- Hindi/native output uses `language_code=hi-IN` and `mode=transcribe`.
- Hinglish/Roman output uses `language_code=hi-IN` and `mode=translit`.
- Automatic mixed-language output uses `language_code=unknown` and `mode=codemix`.
- Requests enable provider timestamps. The main VAD chunker keeps REST requests
  below the provider's 30-second synchronous limit.

Native provider text is canonical. Post-processing performs NFC Unicode and
whitespace normalization plus small exact-token vocabulary corrections. It
does not strip punctuation or run provider `translit` output through the custom
Devanagari romanizer.

Production logs contain provider/model/mode/language code, chunk counts, timing
shape, and raw-versus-normalized character difference counts. Full transcript
text is not logged. Set `SARVAM_SAVE_REDACTED_RESPONSE_SHAPE_DIR` only in a
controlled debug environment to store response-shape diagnostics.

Custom ITRANS conversion remains a fallback for non-Sarvam providers. Its
nasal handling is consonant-class-aware and its terminal-schwa rule applies
only to Devanagari tokens ending in a consonant.

Official references:

- [Saaras model and modes](https://docs.sarvam.ai/api/getting-started/models/saaras)
- [Speech-to-text REST API](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/rest-api)
- [Language-code selection](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/how-to/specify-language-codes)

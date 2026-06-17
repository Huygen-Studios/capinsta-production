from ai_pipeline.sync.stable_refine import match_stable_words_to_provider_words


def test_token_match_transfers_by_coverage_metadata():
    provider = [{"word": "hello"}, {"word": "duniya"}]
    stable = [{"word": "hello", "start": 0, "end": 0.2}, {"word": "duniya", "start": 0.2, "end": 0.5}]
    result = match_stable_words_to_provider_words(provider, stable)
    assert result["matchedWordCount"] == 2
    assert result["matchCoverage"] == 1.0


def test_low_coverage_is_reported():
    provider = [{"word": "namaste"}, {"word": "duniya"}]
    stable = [{"word": "hello", "start": 0, "end": 0.2}]
    result = match_stable_words_to_provider_words(provider, stable)
    assert result["matchedWordCount"] == 0
    assert result["matchCoverage"] == 0

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


def test_repeated_tokens_match_one_to_one_by_local_occurrence_and_group_window():
    provider = [
        {"word": "2", "alignmentGroupId": "g1", "sourceStart": 17.5, "sourceEnd": 18.6},
        {"word": "roopaayalu", "alignmentGroupId": "g1", "sourceStart": 17.5, "sourceEnd": 18.6},
        {"word": "2", "alignmentGroupId": "g2", "sourceStart": 19.0, "sourceEnd": 20.2},
        {"word": "roopaayalu", "alignmentGroupId": "g2", "sourceStart": 19.0, "sourceEnd": 20.2},
        {"word": "enni", "alignmentGroupId": "g3", "sourceStart": 25.0, "sourceEnd": 26.0},
        {"word": "enni", "alignmentGroupId": "g3", "sourceStart": 25.0, "sourceEnd": 26.0},
    ]
    stable = [
        {"word": "2", "start": 17.7, "end": 17.9},
        {"word": "roopaayalu", "start": 18.0, "end": 18.4},
        {"word": "2", "start": 19.2, "end": 19.35},
        {"word": "roopaayalu", "start": 19.4, "end": 19.9},
        {"word": "enni", "start": 25.1, "end": 25.2},
        {"word": "enni", "start": 25.25, "end": 25.35},
    ]

    result = match_stable_words_to_provider_words(provider, stable)

    assert result["matches"] == {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5}
    assert len(set(result["matches"].values())) == len(result["matches"])

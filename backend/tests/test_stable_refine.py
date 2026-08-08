from ai_pipeline.sync.stable_refine import match_stable_words_to_provider_words


def test_token_match_transfers_by_coverage_metadata():
    provider = [
        {"word": "hello", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 0.5},
        {"word": "duniya", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 0.5},
    ]
    stable = [{"word": "hello", "start": 0, "end": 0.2}, {"word": "duniya", "start": 0.2, "end": 0.5}]
    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)
    assert result["matchedWordCount"] == 2
    assert result["matchCoverage"] == 1.0


def test_low_coverage_is_reported():
    provider = [
        {"word": "namaste", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 0.5},
        {"word": "duniya", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 0.5},
    ]
    stable = [{"word": "hello", "start": 0, "end": 0.2}]
    result = match_stable_words_to_provider_words(provider, stable)
    assert result["matchedWordCount"] == 0
    assert result["matchCoverage"] == 0


def test_matcher_does_not_match_words_missing_alignment_group():
    provider = [{"word": "hello", "sourceStart": 0.0, "sourceEnd": 0.4}]
    stable = [{"word": "hello", "start": 0.1, "end": 0.3}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matchedWordCount"] == 0
    assert result["missingAlignmentGroupWords"] == 1


def test_repeated_tokens_match_one_to_one_by_local_occurrence_and_group_window():
    provider = [
        {"word": "2", "alignmentGroupId": "g1", "sourceStart": 17.5, "sourceEnd": 18.6},
        {"word": "roopaayalu", "alignmentGroupId": "g1", "sourceStart": 17.5, "sourceEnd": 18.6},
        {"word": "2", "alignmentGroupId": "g2", "sourceStart": 19.0, "sourceEnd": 20.2},
        {"word": "roopaayalu", "alignmentGroupId": "g2", "sourceStart": 19.0, "sourceEnd": 20.2},
        {
            "word": "enni",
            "alignmentGroupId": "g3",
            "sourceStart": 25.0,
            "sourceEnd": 26.0,
            "localSourceStart": 25.05,
            "localSourceEnd": 25.2,
        },
        {
            "word": "enni",
            "alignmentGroupId": "g3",
            "sourceStart": 25.0,
            "sourceEnd": 26.0,
            "localSourceStart": 25.23,
            "localSourceEnd": 25.4,
        },
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


def test_repeated_short_token_prefers_later_local_occurrence_over_broad_first_match():
    provider = [
        {
            "word": "yes",
            "alignmentGroupId": "g1",
            "sourceStart": 0.0,
            "sourceEnd": 10.0,
            "localSourceStart": 1.0,
            "localSourceEnd": 1.3,
        },
        {
            "word": "yes",
            "alignmentGroupId": "g1",
            "sourceStart": 0.0,
            "sourceEnd": 10.0,
            "localSourceStart": 8.0,
            "localSourceEnd": 8.3,
        },
    ]
    stable = [{"word": "yes", "start": 8.05, "end": 8.2}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {1: 0}
    assert result["ambiguousRepeatedTokenRejectedWords"] == 1


def test_repeated_token_without_local_contradiction_keeps_monotonic_match():
    provider = [
        {"word": "yes", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 10.0},
        {"word": "yes", "alignmentGroupId": "g1", "sourceStart": 0.0, "sourceEnd": 10.0},
    ]
    stable = [{"word": "yes", "start": 8.05, "end": 8.2}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0}
    assert result["ambiguousRepeatedTokenRejectedWords"] == 0


def test_unique_token_can_use_broad_group_window_when_local_window_is_not_enough():
    provider = [
        {
            "word": "adugutaagandi",
            "alignmentGroupId": "g1",
            "sourceStart": 8.0,
            "sourceEnd": 10.0,
            "localSourceStart": 8.1,
            "localSourceEnd": 8.4,
        },
    ]
    stable = [{"word": "adugutaagandi", "start": 9.2, "end": 9.5}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0}
    assert result["ambiguousRepeatedTokenRejectedWords"] == 0


def test_stable_duration_outlier_outside_native_occurrence_is_rejected():
    provider = [
        {
            "word": "answer",
            "alignmentGroupId": "g1",
            "providerTokenId": "tok-answer",
            "localGroupTokenIndex": 0,
            "sourceStart": 10.0,
            "sourceEnd": 15.0,
            "localSourceStart": 10.0,
            "localSourceEnd": 15.0,
            "nativeStart": 12.0,
            "nativeEnd": 12.8,
            "timingSource": "provider_native",
        }
    ]
    stable = [{"word": "answer", "start": 10.4, "end": 10.48}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {}
    assert result["durationOutlierRejectedWords"] == 1
    assert result["rejectionSamples"] == [
        {
            "reason": "stable_ts_native_duration_outlier",
            "providerIndex": 0,
            "stableIndex": 0,
            "providerTokenId": "tok-answer",
            "word": "answer",
            "alignmentGroupId": "g1",
            "localGroupTokenIndex": 0,
            "sourceSegmentIndex": None,
            "sourceStart": 10.0,
            "sourceEnd": 15.0,
            "localSourceStart": 10.0,
            "localSourceEnd": 15.0,
            "nativeStart": 12.0,
            "nativeEnd": 12.8,
            "stableWord": "answer",
            "stableStart": 10.4,
            "stableEnd": 10.48,
        }
    ]


def test_stable_duration_outlier_inside_native_occurrence_is_allowed():
    provider = [
        {
            "word": "yes",
            "alignmentGroupId": "g1",
            "sourceStart": 10.0,
            "sourceEnd": 12.0,
            "localSourceStart": 10.0,
            "localSourceEnd": 12.0,
            "nativeStart": 10.8,
            "nativeEnd": 11.6,
            "timingSource": "provider_native",
        }
    ]
    stable = [{"word": "yes", "start": 10.95, "end": 11.03}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0}
    assert result["durationOutlierRejectedWords"] == 0


def test_deterministic_native_fields_do_not_reject_stable_candidate():
    provider = [
        {
            "word": "answer",
            "alignmentGroupId": "g1",
            "sourceStart": 10.0,
            "sourceEnd": 15.0,
            "localSourceStart": 10.0,
            "localSourceEnd": 15.0,
            "nativeStart": 12.0,
            "nativeEnd": 12.8,
            "timingSource": "deterministic_fallback",
        }
    ]
    stable = [{"word": "answer", "start": 10.4, "end": 10.48}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0}
    assert result["durationOutlierRejectedWords"] == 0


def test_stable_token_is_not_reused_for_multiple_provider_words():
    provider = [
        {
            "word": "go",
            "alignmentGroupId": "g1",
            "sourceStart": 0.0,
            "sourceEnd": 2.0,
            "localSourceStart": 0.1,
            "localSourceEnd": 0.4,
        },
        {
            "word": "go",
            "alignmentGroupId": "g1",
            "sourceStart": 0.0,
            "sourceEnd": 2.0,
            "localSourceStart": 0.1,
            "localSourceEnd": 0.4,
        },
    ]
    stable = [{"word": "go", "start": 0.15, "end": 0.3}]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0}
    assert len(set(result["matches"].values())) == len(result["matches"])


def test_number_word_variants_match_only_inside_same_group_window():
    provider = [
        {"word": "rendu", "alignmentGroupId": "g1", "sourceStart": 10.0, "sourceEnd": 10.8},
        {"word": "rendu", "alignmentGroupId": "g2", "sourceStart": 12.0, "sourceEnd": 12.8},
    ]
    stable = [
        {"word": "2", "start": 10.1, "end": 10.3},
        {"word": "2", "start": 12.1, "end": 12.3},
    ]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0, 1: 1}


def test_small_spelling_variants_match_without_crossing_group():
    provider = [
        {"word": "kottiddaam", "alignmentGroupId": "g1", "sourceStart": 8.0, "sourceEnd": 8.8},
        {"word": "kottiddaam", "alignmentGroupId": "g2", "sourceStart": 18.0, "sourceEnd": 18.8},
    ]
    stable = [
        {"word": "kottiddam", "start": 8.1, "end": 8.5},
        {"word": "kottiddam", "start": 18.1, "end": 18.5},
    ]

    result = match_stable_words_to_provider_words(provider, stable, require_alignment_groups=True)

    assert result["matches"] == {0: 0, 1: 1}

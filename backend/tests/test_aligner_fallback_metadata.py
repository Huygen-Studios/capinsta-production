from ai_pipeline.aligner import align_text
from ai_pipeline.sync.stable_refine import _apply_matched_timings, ensure_alignment_groups
from ai_pipeline.transcript_normalizer import normalize_aligned_segments


def test_deterministic_fallback_preserves_source_window_for_later_stable_matching():
    aligned = align_text(
        [
            {
                "text": "adugutaa aagandi",
                "start": 8.142,
                "end": 9.062,
                "sourceSegmentIndex": 4,
                "sourceChunkIndex": 0,
                "sourceStart": 8.0,
                "sourceEnd": 9.4,
            }
        ],
        "unused.wav",
        "unused-model",
        provider="stable_ts",
        allow_fallback=True,
    )

    assert len(aligned) == 1
    assert aligned[0]["sourceStart"] == 8.0
    assert aligned[0]["sourceEnd"] == 9.4
    assert aligned[0]["sourceSegmentIndex"] == 4
    assert aligned[0]["sourceChunkIndex"] == 0
    assert [word["word"] for word in aligned[0]["words"]] == ["adugutaa", "aagandi"]
    for word in aligned[0]["words"]:
        assert word["timingSource"] == "deterministic_fallback"
        assert word["sourceStart"] == 8.0
        assert word["sourceEnd"] == 9.4
        assert word["sourceSegmentIndex"] == 4
        assert word["sourceChunkIndex"] == 0


def test_transcript_normalizer_preserves_alignment_provenance_metadata():
    normalized = normalize_aligned_segments(
        [
            {
                "text": "adugutaa aagandi",
                "start": 8.142,
                "end": 9.062,
                "sourceSegmentIndex": 4,
                "sourceChunkIndex": 0,
                "sourceStart": 8.0,
                "sourceEnd": 9.4,
                "words": [
                    {
                        "word": "adugutaa",
                        "start": 8.142,
                        "end": 8.6,
                        "timingSource": "deterministic_fallback",
                        "sourceSegmentIndex": 4,
                        "sourceChunkIndex": 0,
                        "sourceStart": 8.0,
                        "sourceEnd": 9.4,
                        "providerTokenId": "ag-1:4:0",
                    },
                    {
                        "word": "aagandi",
                        "start": 8.6,
                        "end": 9.062,
                        "timingSource": "deterministic_fallback",
                        "sourceSegmentIndex": 4,
                        "sourceChunkIndex": 0,
                        "sourceStart": 8.0,
                        "sourceEnd": 9.4,
                        "providerTokenId": "ag-1:4:1",
                    },
                ],
            }
        ],
        "telgish",
    )

    assert normalized[0]["sourceSegmentIndex"] == 4
    assert normalized[0]["sourceChunkIndex"] == 0
    assert normalized[0]["sourceStart"] == 8.0
    assert normalized[0]["sourceEnd"] == 9.4
    for word in normalized[0]["words"]:
        assert word["sourceSegmentIndex"] == 4
        assert word["sourceChunkIndex"] == 0
        assert word["sourceStart"] == 8.0
        assert word["sourceEnd"] == 9.4
        assert word["providerTokenId"].startswith("ag-1:4:")


def test_generated_provider_token_ids_are_unique_inside_same_alignment_group():
    segments = [
        {
            "alignmentGroupId": "ag-0000",
            "sourceSegmentIndex": 0,
            "sourceStart": 0.0,
            "sourceEnd": 4.0,
            "words": [
                {"word": "okka", "start": 0.3, "end": 0.5},
                {"word": "roopaayiki", "start": 0.5, "end": 0.9},
            ],
        },
        {
            "alignmentGroupId": "ag-0000",
            "sourceSegmentIndex": 0,
            "sourceStart": 0.0,
            "sourceEnd": 4.0,
            "words": [
                {"word": "vastundo", "start": 2.3, "end": 2.5},
                {"word": "telusukovalani", "start": 2.5, "end": 2.7},
            ],
        },
    ]

    grouped = ensure_alignment_groups(segments)
    token_ids = [
        word["providerTokenId"]
        for segment in grouped
        for word in segment["words"]
    ]

    assert token_ids == [
        "ag-0000:0:0",
        "ag-0000:0:1",
        "ag-0000:0:2",
        "ag-0000:0:3",
    ]
    assert len(token_ids) == len(set(token_ids))


def test_stable_ts_order_violation_rolls_back_alignment_group():
    segments = ensure_alignment_groups(
        [
            {
                "alignmentGroupId": "ag-0000",
                "sourceSegmentIndex": 0,
                "sourceStart": 40.0,
                "sourceEnd": 43.0,
                "words": [
                    {
                        "word": "first",
                        "start": 40.1,
                        "end": 40.5,
                        "timingSource": "deterministic_fallback",
                    },
                    {
                        "word": "second",
                        "start": 40.6,
                        "end": 41.0,
                        "timingSource": "deterministic_fallback",
                    },
                ],
            }
        ]
    )
    rows = [(0, index, word) for index, word in enumerate(segments[0]["words"])]
    diagnostics: dict[str, object] = {}

    applied = _apply_matched_timings(
        segments,
        rows,
        [
            {"word": "first", "start": 42.0, "end": 42.2},
            {"word": "second", "start": 41.8, "end": 42.0},
        ],
        {0: 0, 1: 1},
        "stable_ts_forced_align",
        diagnostics=diagnostics,
    )

    words = segments[0]["words"]
    assert applied == 0
    assert diagnostics["stableTsGroupRollbackWords"] == 2
    assert words[0]["start"] == 40.1
    assert words[0]["end"] == 40.5
    assert words[1]["start"] == 40.6
    assert words[1]["end"] == 41.0
    assert words[0]["timingSource"] == "deterministic_fallback"
    assert words[1]["timingRepairReason"] == "stable_ts_group_candidate_rolled_back"

from ai_pipeline.timing import build_timing_report, classify_caption_gaps


def test_report_includes_sync_metadata():
    segments = [{"start": 0, "end": 0.5, "text": "hi", "words": [{"word": "hi", "start": 0, "end": 0.5, "timingSource": "estimated"}]}]
    report = build_timing_report(
        segments,
        [],
        {"autoGlobalSync": {"applied": True, "shiftSeconds": -0.2, "skew": 1.001, "quality": 0.8, "improvement": 0.1}, "stableTs": {"appliedWords": 1, "matchCoverage": 0.75}},
    )
    assert report["autoSyncApplied"] is True
    assert report["globalShiftSeconds"] == -0.2
    assert report["stableTsCoverage"] == 0.75
    assert report["estimatedWordCount"] == 1


def test_caption_gap_analyzer_classifies_speech_and_silence():
    segments = [{"start": 0, "end": 1, "text": "a"}, {"start": 3, "end": 4, "text": "b"}]
    speech_gap = classify_caption_gaps(segments, [{"start": 1.5, "end": 2.0}], min_gap_seconds=0.5)
    silence_gap = classify_caption_gaps(segments, [{"start": 4.5, "end": 5.0}], min_gap_seconds=0.5)
    unknown_gap = classify_caption_gaps(segments, None, min_gap_seconds=0.5)

    assert speech_gap[0]["speechOverlapStatus"] == "speech"
    assert "overlaps speech" in speech_gap[0]["message"]
    assert silence_gap[0]["speechOverlapStatus"] == "silence"
    assert "detected silence" in silence_gap[0]["message"]
    assert unknown_gap[0]["speechOverlapStatus"] == "unknown"

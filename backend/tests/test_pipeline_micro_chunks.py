from ai_pipeline.main import _is_skippable_empty_micro_chunk_error


def test_empty_transcript_micro_chunk_is_skippable():
    assert _is_skippable_empty_micro_chunk_error(
        RuntimeError("All configured transcription providers failed: sarvam(empty_transcript)."),
        chunk_duration=0.29,
        pause_threshold=0.25,
    )


def test_empty_transcript_normal_chunk_is_not_skippable():
    assert not _is_skippable_empty_micro_chunk_error(
        RuntimeError("All configured transcription providers failed: sarvam(empty_transcript)."),
        chunk_duration=1.25,
        pause_threshold=0.25,
    )


def test_non_empty_transcription_failure_is_not_skippable():
    assert not _is_skippable_empty_micro_chunk_error(
        RuntimeError("All configured transcription providers failed: sarvam(authentication_failed)."),
        chunk_duration=0.29,
        pause_threshold=0.25,
    )

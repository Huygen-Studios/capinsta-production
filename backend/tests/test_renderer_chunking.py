import pytest
from ai_pipeline.renderer import CaptionCueValidationError, chunk_words_into_captions, validate_caption_cues

def test_chunking_punctuation_split():
    # Under tight word limits, punctuation splits are preserved where merging is blocked by limits
    words = [
        {"word": "hello,", "start": 0.0, "end": 0.5},
        {"word": "world.", "start": 0.6, "end": 1.0},
        {"word": "how", "start": 1.1, "end": 1.5},
        {"word": "are", "start": 1.6, "end": 2.0},
        {"word": "you?", "start": 2.1, "end": 2.5},
        {"word": "fine", "start": 2.6, "end": 3.0},
    ]
    
    rules = {
        "max_chars": 50,
        "pause_split_threshold": 1.0,
        "min_words": 1,
        "max_words": 3,
        "max_duration": 5.0,
        "phrase_hold": 0.1,
    }
    
    captions = chunk_words_into_captions(words, rules)
    assert len(captions) == 3
    assert captions[0]["text"] == "hello, world."
    assert captions[1]["text"] == "how are you?"
    assert captions[2]["text"] == "fine"

def test_chunking_character_overflow():
    # If adding the next word exceeds max_chars, it should split and move that word to the next card
    words = [
        {"word": "this", "start": 0.0, "end": 0.5},
        {"word": "is", "start": 0.6, "end": 1.0},
        {"word": "a", "start": 1.1, "end": 1.5},
        {"word": "verylongwordthatwilltriggeroverflow", "start": 1.6, "end": 2.0},
    ]
    
    rules = {
        "max_chars": 15,
        "pause_split_threshold": 1.0,
        "min_words": 1,
        "max_words": 10,
        "max_duration": 5.0,
        "phrase_hold": 0.1,
    }
    
    captions = chunk_words_into_captions(words, rules)
    assert len(captions) == 2
    assert captions[0]["text"] == "this is a"
    assert captions[1]["text"] == "verylongwordthatwilltriggeroverflow"

def test_merge_across_punctuation_if_no_silence():
    # Short captions ending in punctuation should merge if the gap is below the silence threshold (no silence)
    words = [
        {"word": "yes.", "start": 0.0, "end": 0.5},
        {"word": "no", "start": 0.6, "end": 1.0},
    ]
    
    # Gap is 0.1s, pause_split_threshold is 1.0s (no silence)
    rules = {
        "max_chars": 50,
        "pause_split_threshold": 1.0,
        "min_words": 1,
        "max_words": 10,
        "max_duration": 5.0,
        "phrase_hold": 0.1,
    }
    
    captions = chunk_words_into_captions(words, rules)
    assert len(captions) == 1
    assert captions[0]["text"] == "yes. no"

    # If the gap is equal to or larger than the silence threshold, they must NOT merge
    rules_with_silence = {
        "max_chars": 50,
        "pause_split_threshold": 0.1, # silence gap is 0.1s
        "min_words": 1,
        "max_words": 10,
        "max_duration": 5.0,
        "phrase_hold": 0.1,
    }
    captions_silence = chunk_words_into_captions(words, rules_with_silence)
    assert len(captions_silence) == 2
    assert captions_silence[0]["text"] == "yes."
    assert captions_silence[1]["text"] == "no"

def test_default_pause_splits():
    # 300ms pauses should split captions by default
    words = [
        {"word": "hello", "start": 0.0, "end": 0.5},
        {"word": "world", "start": 0.81, "end": 1.3}, # gap = 0.31s (>= 0.3s)
        {"word": "how", "start": 1.4, "end": 1.8},    # gap = 0.1s (< 0.3s)
    ]
    
    # Using default rules (pause_split_threshold is 0.3s)
    captions = chunk_words_into_captions(words)
    assert len(captions) == 2
    assert captions[0]["text"] == "hello"
    assert captions[1]["text"] == "world how"


def test_caption_chunk_does_not_span_preserved_silence():
    words = [
        {"word": "spends", "start": 0.5, "end": 0.9},
        {"word": "around", "start": 0.9, "end": 1.2},
        {"word": "22", "start": 2.4, "end": 2.65},
        {"word": "lakh", "start": 2.66, "end": 2.9},
        {"word": "crore", "start": 2.91, "end": 3.2},
    ]

    captions = chunk_words_into_captions(
        words,
        {"pause_split_threshold": 0.45, "phrase_hold": 0.0},
    )

    assert [caption["text"] for caption in captions] == [
        "spends around",
        "22 lakh crore",
    ]
    assert captions[0]["end"] <= 1.2
    assert captions[1]["start"] >= 2.4


def test_min_words_does_not_borrow_across_hard_boundary_for_one_word_reply():
    words = [
        {"word": "asked", "start": 0.0, "end": 0.3, "alignmentGroupId": "a"},
        {"word": "wait", "start": 0.32, "end": 0.6, "alignmentGroupId": "a", "hardBoundaryAfter": True},
        {"word": "no", "start": 0.9, "end": 1.05, "alignmentGroupId": "b", "hardBoundaryBefore": True},
    ]

    captions = chunk_words_into_captions(
        words,
        {
            "target_words": 2,
            "min_words": 2,
            "max_words": 3,
            "max_chars": 50,
            "pause_split_threshold": 10,
            "phrase_hold": 0.0,
        },
    )

    assert [caption["text"] for caption in captions] == ["asked wait", "no"]


def test_caption_validation_rejects_duplicate_token_occurrence():
    captions = [
        {
            "text": "2 roopaayalu",
            "start": 0.0,
            "end": 0.5,
            "words": [
                {"word": "2", "start": 0.0, "end": 0.1, "providerTokenId": "g1:0:0", "finalTokenSequenceIndex": 0},
                {"word": "roopaayalu", "start": 0.1, "end": 0.5, "providerTokenId": "g1:0:1", "finalTokenSequenceIndex": 1},
            ],
        },
        {
            "text": "2",
            "start": 0.6,
            "end": 0.8,
            "words": [
                {"word": "2", "start": 0.6, "end": 0.8, "providerTokenId": "g1:0:0", "finalTokenSequenceIndex": 2},
            ],
        },
    ]

    with pytest.raises(CaptionCueValidationError) as exc:
        validate_caption_cues(captions, stage="test")

    assert exc.value.report["duplicateTokenCount"] == 1


def test_caption_validation_rejects_rounded_export_overlap():
    captions = [
        {"text": "previous", "start": 59.981, "end": 60.361, "words": [{"word": "previous", "providerTokenId": "g1:0:0", "finalTokenSequenceIndex": 0}]},
        {"text": "next", "start": 60.347, "end": 60.621, "words": [{"word": "next", "providerTokenId": "g2:1:0", "finalTokenSequenceIndex": 1}]},
    ]

    with pytest.raises(CaptionCueValidationError) as exc:
        validate_caption_cues(captions, stage="srt_generation")

    assert exc.value.report["overlapCount"] == 1

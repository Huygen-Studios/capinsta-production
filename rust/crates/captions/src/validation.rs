use crate::{CaptionDocument, CaptionTimingConfig, TimingSource, ValidationFailure};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ValidationOutcome {
    pub repaired_word_count: usize,
    pub estimated_word_count: usize,
    pub requires_forced_alignment: bool,
    pub maximum_timing_drift_us: i64,
    pub failures: Vec<ValidationFailure>,
}

fn failure(
    code: &str,
    message: &str,
    word_id: Option<String>,
    delta_us: Option<i64>,
    requires_forced_alignment: bool,
) -> ValidationFailure {
    ValidationFailure {
        code: code.to_owned(),
        message: message.to_owned(),
        word_id,
        delta_us,
        requires_forced_alignment,
    }
}

/// Validates and performs only deterministic, bounded repairs.
///
/// Large overlaps, missing timing, low confidence, and duration drift are not
/// hidden: they request forced alignment and disable active-word effects.
pub fn validate_and_repair_document(
    document: &mut CaptionDocument,
    config: &CaptionTimingConfig,
) -> ValidationOutcome {
    let config = config.clone().normalized();
    let mut outcome = ValidationOutcome::default();
    let mut previous_end = 0_i64;

    if document.words.is_empty() {
        outcome.requires_forced_alignment = true;
        outcome.failures.push(failure(
            "provider_word_timestamps_missing",
            "Provider returned no canonical word timestamps",
            None,
            None,
            true,
        ));
    }

    for word in &mut document.words {
        if word.start_us < 0 {
            let delta = -word.start_us;
            if delta <= config.tiny_overlap_tolerance_us {
                word.start_us = 0;
                word.timing_source = TimingSource::RepairedProvider;
                outcome.repaired_word_count += 1;
            } else {
                word.timing_needs_review = true;
                outcome.requires_forced_alignment = true;
                outcome.failures.push(failure(
                    "negative_word_start",
                    "Word begins materially before project zero",
                    Some(word.id.clone()),
                    Some(delta),
                    true,
                ));
            }
        }

        if word.end_us > document.media_duration_us {
            let delta = word.end_us - document.media_duration_us;
            if delta <= config.tiny_overlap_tolerance_us {
                word.end_us = document.media_duration_us;
                word.timing_source = TimingSource::RepairedProvider;
                outcome.repaired_word_count += 1;
            } else {
                word.timing_needs_review = true;
                outcome.requires_forced_alignment = true;
                outcome.failures.push(failure(
                    "word_past_media_duration",
                    "Word ends materially after decoded media duration",
                    Some(word.id.clone()),
                    Some(delta),
                    true,
                ));
            }
        }

        if word.end_us <= word.start_us {
            word.end_us = word
                .start_us
                .saturating_add(config.min_word_duration_us)
                .min(document.media_duration_us);
            word.timing_source = TimingSource::Estimated;
            word.timing_needs_review = true;
            outcome.requires_forced_alignment = true;
            outcome.failures.push(failure(
                "non_positive_word_duration",
                "Word had no valid duration; placeholder duration inserted",
                Some(word.id.clone()),
                None,
                true,
            ));
        }

        if word.start_us < previous_end {
            let overlap = previous_end - word.start_us;
            outcome.maximum_timing_drift_us = outcome.maximum_timing_drift_us.max(overlap);
            if overlap <= config.tiny_overlap_tolerance_us
                && word.end_us - previous_end >= config.min_word_duration_us
            {
                word.start_us = previous_end;
                word.timing_source = TimingSource::RepairedProvider;
                word.timing_diagnostic =
                    Some(format!("tiny provider overlap repaired by {}us", overlap));
                outcome.repaired_word_count += 1;
            } else {
                word.timing_needs_review = true;
                outcome.requires_forced_alignment = true;
                outcome.failures.push(failure(
                    "significant_word_overlap",
                    "Provider word intervals overlap beyond the deterministic repair tolerance",
                    Some(word.id.clone()),
                    Some(overlap),
                    true,
                ));
            }
        }

        if word
            .confidence
            .is_some_and(|confidence| confidence < config.forced_alignment_confidence_threshold)
        {
            word.timing_needs_review = true;
            outcome.requires_forced_alignment = true;
            outcome.failures.push(failure(
                "low_timing_confidence",
                "Provider confidence is below the forced-alignment threshold",
                Some(word.id.clone()),
                None,
                true,
            ));
        }

        if word.timing_source == TimingSource::Estimated || word.timing_needs_review {
            outcome.estimated_word_count +=
                usize::from(word.timing_source == TimingSource::Estimated);
            outcome.requires_forced_alignment = true;
        }
        previous_end = previous_end.max(word.end_us);
    }

    if document.diagnostics.decoded_duration_us > 0 && document.diagnostics.provider_duration_us > 0
    {
        let drift = (document.diagnostics.decoded_duration_us
            - document.diagnostics.provider_duration_us)
            .abs();
        outcome.maximum_timing_drift_us = outcome.maximum_timing_drift_us.max(drift);
        let allowed = 100_000_i64.max(document.diagnostics.decoded_duration_us / 100);
        if drift > allowed {
            outcome.requires_forced_alignment = true;
            outcome.failures.push(failure(
                "provider_duration_drift",
                "Provider and decoded-audio durations differ beyond tolerance",
                None,
                Some(drift),
                true,
            ));
        }
    }

    document.diagnostics.repaired_word_count += outcome.repaired_word_count;
    document.diagnostics.estimated_word_count = document
        .words
        .iter()
        .filter(|word| word.timing_source == TimingSource::Estimated)
        .count();
    document.diagnostics.maximum_timing_drift_us = outcome.maximum_timing_drift_us;
    document
        .diagnostics
        .validation_failures
        .extend(outcome.failures.clone());
    outcome
}

pub trait ForcedAligner {
    type Error;

    fn align(
        &self,
        normalized_pcm: &[i16],
        sample_rate: u32,
        words: &[crate::TimedWord],
        timeline_offset_us: i64,
    ) -> Result<Vec<crate::TimedWord>, Self::Error>;
}

#[derive(Clone, Debug, PartialEq)]
pub enum AlignmentFallbackResult<E> {
    NotRequired,
    Applied { aligned_words: usize },
    Failed { error: E },
}

pub fn apply_forced_alignment_if_required<A: ForcedAligner>(
    document: &mut CaptionDocument,
    normalized_pcm: &[i16],
    sample_rate: u32,
    aligner: &A,
    validation: &ValidationOutcome,
) -> AlignmentFallbackResult<A::Error> {
    if !validation.requires_forced_alignment {
        return AlignmentFallbackResult::NotRequired;
    }
    match aligner.align(
        normalized_pcm,
        sample_rate,
        &document.words,
        document.timeline_offset_us,
    ) {
        Ok(mut words) => {
            for word in &mut words {
                word.timing_source = TimingSource::ForcedAlignment;
                word.timing_needs_review = false;
                word.timing_diagnostic = None;
            }
            let count = words.len();
            document.words = words;
            document.diagnostics.forced_aligned_word_count = count;
            AlignmentFallbackResult::Applied {
                aligned_words: count,
            }
        }
        Err(error) => AlignmentFallbackResult::Failed { error },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CaptionDocument, TimedWord, TimingDiagnostics, TimingSource};

    fn word(id: &str, start_us: i64, end_us: i64) -> TimedWord {
        TimedWord {
            id: id.to_owned(),
            spoken_text: id.to_owned(),
            display_text: id.to_owned(),
            start_us,
            end_us,
            confidence: Some(0.9),
            timing_source: TimingSource::Provider,
            timing_needs_review: false,
            provider: None,
            speaker_id: None,
            language: None,
            vad_segment_id: None,
            timing_diagnostic: None,
        }
    }

    fn document(words: Vec<TimedWord>) -> CaptionDocument {
        CaptionDocument {
            version: "capinsta.caption.v2".to_owned(),
            media_duration_us: 10_000_000,
            timeline_offset_us: 0,
            words,
            pages: vec![],
            vad_regions: vec![],
            diagnostics: TimingDiagnostics::default(),
        }
    }

    #[test]
    fn repairs_tiny_overlap_but_flags_large_overlap() {
        let mut doc = document(vec![
            word("one", 1_000_000, 1_500_000),
            word("two", 1_490_000, 2_000_000),
            word("three", 1_800_000, 2_500_000),
        ]);
        let outcome = validate_and_repair_document(&mut doc, &CaptionTimingConfig::default());
        assert_eq!(doc.words[1].start_us, 1_500_000);
        assert_eq!(doc.words[1].timing_source, TimingSource::RepairedProvider);
        assert!(doc.words[2].timing_needs_review);
        assert!(outcome.requires_forced_alignment);
    }

    #[test]
    fn segment_only_or_empty_provider_output_requires_alignment() {
        let mut doc = document(vec![]);
        let outcome = validate_and_repair_document(&mut doc, &CaptionTimingConfig::default());
        assert!(outcome.requires_forced_alignment);
        assert_eq!(outcome.failures[0].code, "provider_word_timestamps_missing");
    }

    struct TestAligner(bool);

    impl ForcedAligner for TestAligner {
        type Error = &'static str;

        fn align(
            &self,
            _normalized_pcm: &[i16],
            _sample_rate: u32,
            words: &[TimedWord],
            _timeline_offset_us: i64,
        ) -> Result<Vec<TimedWord>, Self::Error> {
            if !self.0 {
                return Err("aligner unavailable");
            }
            let mut aligned = words.to_vec();
            aligned[0].start_us = 1_000_000;
            aligned[0].end_us = 1_200_000;
            Ok(aligned)
        }
    }

    #[test]
    fn forced_alignment_success_and_failure_are_explicit() {
        let mut doc = document(vec![word("one", 0, 40_000)]);
        doc.words[0].timing_source = TimingSource::Estimated;
        doc.words[0].timing_needs_review = true;
        let validation = ValidationOutcome {
            requires_forced_alignment: true,
            ..ValidationOutcome::default()
        };
        assert_eq!(
            apply_forced_alignment_if_required(
                &mut doc,
                &[],
                16_000,
                &TestAligner(false),
                &validation
            ),
            AlignmentFallbackResult::Failed {
                error: "aligner unavailable"
            }
        );
        assert!(matches!(
            apply_forced_alignment_if_required(
                &mut doc,
                &[],
                16_000,
                &TestAligner(true),
                &validation
            ),
            AlignmentFallbackResult::Applied { aligned_words: 1 }
        ));
        assert_eq!(doc.words[0].timing_source, TimingSource::ForcedAlignment);
        assert!(!doc.words[0].timing_needs_review);
    }
}

use serde::{Deserialize, Serialize};

use crate::{
    CaptionDocument, CaptionTimingConfig, TimedWord, TimingDiagnostics, TimingSource,
    ValidationFailure, caption_document_version,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWord {
    #[serde(default)]
    pub id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub display_text: Option<String>,
    #[serde(default)]
    pub start_seconds: Option<f64>,
    #[serde(default)]
    pub end_seconds: Option<f64>,
    #[serde(default)]
    pub confidence: Option<f32>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub speaker_id: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub timing_needs_review: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTranscript {
    pub media_duration_us: i64,
    #[serde(default)]
    pub decoded_audio_duration_us: i64,
    #[serde(default)]
    pub provider_duration_seconds: Option<f64>,
    #[serde(default)]
    pub timeline_offset_us: i64,
    pub words: Vec<ProviderWord>,
}

fn seconds_to_us(seconds: f64) -> Option<i64> {
    if !seconds.is_finite() || seconds < 0.0 || seconds > i64::MAX as f64 / 1_000_000.0 {
        return None;
    }
    Some((seconds * 1_000_000.0).round() as i64)
}

pub fn normalize_provider_transcript(
    input: ProviderTranscript,
    config: &CaptionTimingConfig,
) -> CaptionDocument {
    let config = config.clone().normalized();
    let mut diagnostics = TimingDiagnostics {
        decoded_duration_us: input.decoded_audio_duration_us,
        provider_duration_us: input
            .provider_duration_seconds
            .and_then(seconds_to_us)
            .unwrap_or_default(),
        timeline_offset_us: input.timeline_offset_us,
        provider_word_count: input.words.len(),
        ..TimingDiagnostics::default()
    };
    let mut estimated_cursor = input.timeline_offset_us.max(0);
    let mut words = Vec::with_capacity(input.words.len());

    for (index, raw) in input.words.into_iter().enumerate() {
        let word_id = raw
            .id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| format!("word-{}", index + 1));
        let start = raw.start_seconds.and_then(seconds_to_us);
        let end = raw.end_seconds.and_then(seconds_to_us);
        let valid = matches!((start, end), (Some(start), Some(end)) if end > start);
        let (start_us, end_us, timing_source, timing_needs_review, timing_diagnostic) = if valid {
            let start_us = start.unwrap().saturating_add(input.timeline_offset_us);
            let end_us = end.unwrap().saturating_add(input.timeline_offset_us);
            estimated_cursor = end_us;
            if raw.timing_needs_review {
                diagnostics.estimated_word_count += 1;
                (
                    start_us,
                    end_us,
                    TimingSource::Estimated,
                    true,
                    Some("legacy or provider timing was already marked for review".to_owned()),
                )
            } else {
                (start_us, end_us, TimingSource::Provider, false, None)
            }
        } else {
            let start_us = estimated_cursor.max(0);
            let end_us = start_us.saturating_add(config.min_word_duration_us);
            estimated_cursor = end_us;
            diagnostics.estimated_word_count += 1;
            diagnostics.validation_failures.push(ValidationFailure {
                code: "provider_word_timestamps_missing".to_owned(),
                message: "Provider word lacked a valid start/end pair; forced alignment required"
                    .to_owned(),
                word_id: Some(word_id.clone()),
                delta_us: None,
                requires_forced_alignment: true,
            });
            (
                start_us,
                end_us,
                TimingSource::Estimated,
                true,
                Some("minimal-duration placeholder pending forced alignment".to_owned()),
            )
        };
        words.push(TimedWord {
            id: word_id,
            spoken_text: raw.text.clone(),
            display_text: raw.display_text.unwrap_or(raw.text),
            start_us,
            end_us,
            confidence: raw.confidence,
            timing_source,
            timing_needs_review,
            provider: raw.provider,
            speaker_id: raw.speaker_id,
            language: raw.language,
            vad_segment_id: None,
            timing_diagnostic,
        });
    }

    CaptionDocument {
        version: caption_document_version(),
        media_duration_us: input.media_duration_us.max(0),
        timeline_offset_us: input.timeline_offset_us,
        words,
        pages: Vec::new(),
        vad_regions: Vec::new(),
        diagnostics,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyWordSeconds {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub displayed_text: Option<String>,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub timing_needs_review: bool,
}

pub fn migrate_legacy_words(
    duration_seconds: f64,
    words: Vec<LegacyWordSeconds>,
) -> CaptionDocument {
    let provider_words = words
        .into_iter()
        .map(|word| ProviderWord {
            id: Some(word.id),
            text: word.text,
            display_text: word.displayed_text,
            start_seconds: Some(word.start),
            end_seconds: Some(word.end),
            confidence: None,
            provider: Some("legacy_capinsta_v1".to_owned()),
            speaker_id: None,
            language: None,
            timing_needs_review: word.timing_needs_review,
        })
        .collect();
    let mut document = normalize_provider_transcript(
        ProviderTranscript {
            media_duration_us: seconds_to_us(duration_seconds).unwrap_or_default(),
            decoded_audio_duration_us: seconds_to_us(duration_seconds).unwrap_or_default(),
            provider_duration_seconds: Some(duration_seconds),
            timeline_offset_us: 0,
            words: provider_words,
        },
        &CaptionTimingConfig::default(),
    );
    document.version = caption_document_version();
    document
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(start: Option<f64>, end: Option<f64>) -> ProviderWord {
        ProviderWord {
            id: None,
            text: "hello".to_owned(),
            display_text: None,
            start_seconds: start,
            end_seconds: end,
            confidence: Some(0.9),
            provider: Some("test".to_owned()),
            speaker_id: None,
            language: Some("en".to_owned()),
            timing_needs_review: false,
        }
    }

    #[test]
    fn restores_non_zero_selected_range_offset() {
        let document = normalize_provider_transcript(
            ProviderTranscript {
                media_duration_us: 20_000_000,
                decoded_audio_duration_us: 2_000_000,
                provider_duration_seconds: Some(2.0),
                timeline_offset_us: 7_500_000,
                words: vec![word(Some(0.25), Some(0.75))],
            },
            &CaptionTimingConfig::default(),
        );
        assert_eq!(
            (document.words[0].start_us, document.words[0].end_us),
            (7_750_000, 8_250_000)
        );
    }

    #[test]
    fn missing_word_times_are_review_only_placeholders() {
        let document = normalize_provider_transcript(
            ProviderTranscript {
                media_duration_us: 2_000_000,
                decoded_audio_duration_us: 2_000_000,
                provider_duration_seconds: Some(2.0),
                timeline_offset_us: 0,
                words: vec![word(None, None)],
            },
            &CaptionTimingConfig::default(),
        );
        assert_eq!(document.words[0].timing_source, TimingSource::Estimated);
        assert!(document.words[0].timing_needs_review);
        assert!(document.diagnostics.validation_failures[0].requires_forced_alignment);
    }
}

use serde::{Deserialize, Serialize};

use crate::TimedWord;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RationalRate {
    pub numerator: i64,
    pub denominator: i64,
}

impl RationalRate {
    pub const ONE: Self = Self {
        numerator: 1,
        denominator: 1,
    };

    pub fn is_valid(self) -> bool {
        self.numerator > 0 && self.denominator > 0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineMappingSegment {
    pub id: String,
    pub source_start_us: i64,
    pub source_end_us: i64,
    pub sequence_start_us: i64,
    pub playback_rate: RationalRate,
    #[serde(default)]
    pub muted: bool,
}

fn map_source_time(source_us: i64, segment: &TimelineMappingSegment) -> Option<i64> {
    if !segment.playback_rate.is_valid() {
        return None;
    }
    let source_delta = source_us.checked_sub(segment.source_start_us)? as i128;
    let scaled = source_delta
        .checked_mul(segment.playback_rate.denominator as i128)?
        .checked_div(segment.playback_rate.numerator as i128)?;
    i64::try_from(segment.sequence_start_us as i128 + scaled).ok()
}

/// Maps source-relative words through explicit, possibly discontinuous edit
/// segments. Muted segments and words outside source ranges are removed.
pub fn map_source_words_to_timeline(
    words: &[TimedWord],
    mapping_segments: &[TimelineMappingSegment],
) -> Vec<TimedWord> {
    let mut mapped = Vec::new();
    for segment in mapping_segments {
        if segment.muted || segment.source_end_us <= segment.source_start_us {
            continue;
        }
        for word in words {
            if word.end_us <= segment.source_start_us || word.start_us >= segment.source_end_us {
                continue;
            }
            let source_start = word.start_us.max(segment.source_start_us);
            let source_end = word.end_us.min(segment.source_end_us);
            let Some(start_us) = map_source_time(source_start, segment) else {
                continue;
            };
            let Some(end_us) = map_source_time(source_end, segment) else {
                continue;
            };
            if end_us <= start_us {
                continue;
            }
            let mut mapped_word = word.clone();
            mapped_word.id = format!("{}@{}", word.id, segment.id);
            mapped_word.start_us = start_us;
            mapped_word.end_us = end_us;
            mapped.push(mapped_word);
        }
    }
    mapped.sort_by_key(|word| (word.start_us, word.end_us, word.id.clone()));
    mapped
}

#[cfg(test)]
mod tests {
    use crate::TimingSource;

    use super::*;

    fn word(start_us: i64, end_us: i64) -> TimedWord {
        TimedWord {
            id: "word".to_owned(),
            spoken_text: "word".to_owned(),
            display_text: "word".to_owned(),
            start_us,
            end_us,
            confidence: None,
            timing_source: TimingSource::Provider,
            timing_needs_review: false,
            provider: None,
            speaker_id: None,
            language: None,
            vad_segment_id: None,
            timing_diagnostic: None,
        }
    }

    #[test]
    fn maps_speed_adjusted_and_discontinuous_segments() {
        let words = vec![word(1_000_000, 2_000_000), word(6_000_000, 7_000_000)];
        let segments = vec![
            TimelineMappingSegment {
                id: "fast".to_owned(),
                source_start_us: 0,
                source_end_us: 3_000_000,
                sequence_start_us: 10_000_000,
                playback_rate: RationalRate {
                    numerator: 2,
                    denominator: 1,
                },
                muted: false,
            },
            TimelineMappingSegment {
                id: "later".to_owned(),
                source_start_us: 5_000_000,
                source_end_us: 8_000_000,
                sequence_start_us: 20_000_000,
                playback_rate: RationalRate::ONE,
                muted: false,
            },
        ];
        let mapped = map_source_words_to_timeline(&words, &segments);
        assert_eq!(
            (mapped[0].start_us, mapped[0].end_us),
            (10_500_000, 11_000_000)
        );
        assert_eq!(
            (mapped[1].start_us, mapped[1].end_us),
            (21_000_000, 22_000_000)
        );
    }

    #[test]
    fn drops_muted_and_out_of_range_words() {
        let mapped = map_source_words_to_timeline(
            &[word(1_000_000, 2_000_000)],
            &[TimelineMappingSegment {
                id: "muted".to_owned(),
                source_start_us: 0,
                source_end_us: 3_000_000,
                sequence_start_us: 0,
                playback_rate: RationalRate::ONE,
                muted: true,
            }],
        );
        assert!(mapped.is_empty());
    }
}

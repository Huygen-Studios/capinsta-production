use std::collections::HashMap;

use crate::{
    CaptionDocument, CaptionPage, CaptionTimingConfig, TimedWord, VadRegion,
    vad_has_verified_silence,
};

fn strong_punctuation(text: &str) -> bool {
    text.trim_end()
        .chars()
        .last()
        .is_some_and(|character| matches!(character, '.' | '!' | '?' | ',' | ';' | ':' | '।' | '॥'))
}

fn adaptive_pause_threshold(words: &[TimedWord], config: &CaptionTimingConfig) -> i64 {
    if !config.adaptive_pause_threshold || words.len() < 4 {
        return config.pause_threshold_us;
    }
    let mut gaps: Vec<i64> = words
        .windows(2)
        .filter_map(|pair| {
            let gap = pair[1].start_us.saturating_sub(pair[0].end_us);
            (gap > 0 && gap < 2_000_000).then_some(gap)
        })
        .collect();
    if gaps.is_empty() {
        return config.pause_threshold_us;
    }
    gaps.sort_unstable();
    let median = gaps[gaps.len() / 2];
    config
        .pause_threshold_us
        .max(median.saturating_mul(3) / 2)
        .clamp(280_000, 700_000)
}

fn balance_sizes(total: usize, maximum: usize) -> Vec<usize> {
    if total == 0 {
        return Vec::new();
    }
    let chunks = total.div_ceil(maximum.max(1));
    let base = total / chunks;
    let extra = total % chunks;
    (0..chunks)
        .map(|index| base + usize::from(index < extra))
        .collect()
}

fn page_text_length(words: &[TimedWord]) -> usize {
    words
        .iter()
        .map(|word| word.display_text.chars().count())
        .sum::<usize>()
        .saturating_add(words.len().saturating_sub(1))
}

fn split_balanced<'a>(
    words: &'a [TimedWord],
    config: &CaptionTimingConfig,
) -> Vec<&'a [TimedWord]> {
    let mut result = Vec::new();
    let mut cursor = 0;
    for mut size in balance_sizes(words.len(), config.max_words_per_page) {
        while size > 1 {
            let candidate = &words[cursor..cursor + size];
            let duration = candidate
                .last()
                .unwrap()
                .end_us
                .saturating_sub(candidate.first().unwrap().start_us);
            if page_text_length(candidate) <= config.max_chars_per_line
                && duration <= config.max_page_duration_us
            {
                break;
            }
            size -= 1;
        }
        result.push(&words[cursor..cursor + size]);
        cursor += size;
    }
    while cursor < words.len() {
        let remaining = &words[cursor..];
        let size = remaining.len().min(config.max_words_per_page);
        result.push(&remaining[..size]);
        cursor += size;
    }
    result
}

fn verified_pause(
    vad_regions: &[VadRegion],
    gap_start_us: i64,
    gap_end_us: i64,
    config: &CaptionTimingConfig,
) -> bool {
    let gap = gap_end_us.saturating_sub(gap_start_us);
    if gap <= 0 {
        return false;
    }
    if !config.use_vad || vad_regions.is_empty() {
        return true;
    }
    vad_has_verified_silence(vad_regions, gap_start_us, gap_end_us)
}

/// Builds presentation pages solely from canonical word boundaries.
pub fn build_caption_pages(document: &mut CaptionDocument, config: &CaptionTimingConfig) {
    let config = config.clone().normalized();
    document
        .words
        .sort_by_key(|word| (word.start_us, word.end_us, word.id.clone()));
    let pause_threshold = adaptive_pause_threshold(&document.words, &config);
    let mut phrases: Vec<Vec<TimedWord>> = Vec::new();
    let mut current = Vec::new();
    for index in 0..document.words.len() {
        let word = document.words[index].clone();
        current.push(word.clone());
        let next = document.words.get(index + 1);
        let should_split = next.is_none_or(|next| {
            let gap = next.start_us.saturating_sub(word.end_us);
            strong_punctuation(&word.display_text)
                || word.speaker_id != next.speaker_id
                    && word.speaker_id.is_some()
                    && next.speaker_id.is_some()
                || (gap >= pause_threshold
                    && verified_pause(&document.vad_regions, word.end_us, next.start_us, &config))
        });
        if should_split {
            phrases.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        phrases.push(current);
    }

    let mut page_word_ids = Vec::new();
    for phrase in &phrases {
        for chunk in split_balanced(phrase, &config) {
            page_word_ids.push(chunk.iter().map(|word| word.id.clone()).collect::<Vec<_>>());
        }
    }
    let words_by_id: HashMap<_, _> = document
        .words
        .iter()
        .map(|word| (word.id.as_str(), word))
        .collect();
    let starts: Vec<i64> = page_word_ids
        .iter()
        .filter_map(|ids| {
            words_by_id
                .get(ids.first()?.as_str())
                .map(|word| word.start_us)
        })
        .collect();
    document.pages = page_word_ids
        .into_iter()
        .enumerate()
        .filter_map(|(index, word_ids)| {
            let first = words_by_id.get(word_ids.first()?.as_str())?;
            let last = words_by_id.get(word_ids.last()?.as_str())?;
            let next_start = starts
                .get(index + 1)
                .copied()
                .unwrap_or(document.media_duration_us);
            let end_us = last
                .end_us
                .saturating_add(config.post_word_hold_us)
                .min(next_start)
                .min(document.media_duration_us)
                .max(first.start_us + config.min_word_duration_us);
            let effects_enabled = word_ids.iter().all(|id| {
                words_by_id.get(id.as_str()).is_some_and(|word| {
                    word.active_word_effects_enabled(config.allow_estimated_active_words)
                })
            });
            Some(CaptionPage {
                id: format!("page:{}:{}", first.id, last.id),
                word_ids,
                start_us: first.start_us,
                end_us,
                display_text_override: None,
                active_word_effects_enabled: effects_enabled,
            })
        })
        .collect();
}

#[cfg(test)]
mod tests {
    use crate::{TimingDiagnostics, TimingSource, VadRegionKind};

    use super::*;

    fn words(count: usize, gap_us: i64) -> Vec<TimedWord> {
        (0..count)
            .map(|index| TimedWord {
                id: format!("w{index}"),
                spoken_text: format!("w{index}"),
                display_text: format!("w{index}"),
                start_us: index as i64 * (200_000 + gap_us),
                end_us: index as i64 * (200_000 + gap_us) + 150_000,
                confidence: Some(0.9),
                timing_source: TimingSource::Provider,
                timing_needs_review: false,
                provider: None,
                speaker_id: None,
                language: None,
                vad_segment_id: None,
                timing_diagnostic: None,
            })
            .collect()
    }

    fn doc(words: Vec<TimedWord>, duration: i64) -> CaptionDocument {
        CaptionDocument {
            version: "capinsta.caption.v2".to_owned(),
            media_duration_us: duration,
            timeline_offset_us: 0,
            words,
            pages: vec![],
            vad_regions: vec![],
            diagnostics: TimingDiagnostics::default(),
        }
    }

    #[test]
    fn balances_nine_words_as_three_three_three() {
        let mut document = doc(words(9, 10_000), 10_000_000);
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert_eq!(
            document
                .pages
                .iter()
                .map(|page| page.word_ids.len())
                .collect::<Vec<_>>(),
            vec![3, 3, 3]
        );
    }

    #[test]
    fn preserves_long_blank_silence_with_250ms_hold() {
        let mut input = words(2, 0);
        input[0].start_us = 3_700_000;
        input[0].end_us = 4_000_000;
        input[0].display_text = "Sentence.".to_owned();
        input[1].start_us = 6_500_000;
        input[1].end_us = 6_800_000;
        let mut document = doc(input, 8_000_000);
        document.vad_regions = vec![VadRegion {
            id: "silence".to_owned(),
            kind: VadRegionKind::Silence,
            start_us: 4_000_000,
            end_us: 6_500_000,
            confidence: Some(1.0),
        }];
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert_eq!(document.pages[0].end_us, 4_250_000);
        assert_eq!(document.pages[1].start_us, 6_500_000);
        assert_eq!(
            document.pages[1].start_us - document.pages[0].end_us,
            2_250_000
        );
    }

    #[test]
    fn short_silence_does_not_force_a_boundary() {
        let mut document = doc(words(2, 100_000), 2_000_000);
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert_eq!(document.pages.len(), 1);
    }

    #[test]
    fn vad_speech_wins_when_asr_reports_a_large_gap() {
        let mut input = words(2, 0);
        input[0].end_us = 300_000;
        input[1].start_us = 1_000_000;
        input[1].end_us = 1_200_000;
        let mut document = doc(input, 2_000_000);
        document.vad_regions = vec![VadRegion {
            id: "speech".to_owned(),
            kind: VadRegionKind::Speech,
            start_us: 0,
            end_us: 1_300_000,
            confidence: Some(0.9),
        }];
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert_eq!(document.pages.len(), 1);
    }

    #[test]
    fn final_page_is_clamped_to_media_duration() {
        let mut document = doc(words(1, 0), 200_000);
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert_eq!(document.pages[0].end_us, 200_000);
    }

    #[test]
    fn estimated_word_disables_active_effects() {
        let mut input = words(1, 0);
        input[0].timing_source = TimingSource::Estimated;
        input[0].timing_needs_review = true;
        let mut document = doc(input, 1_000_000);
        build_caption_pages(&mut document, &CaptionTimingConfig::default());
        assert!(!document.pages[0].active_word_effects_enabled);
    }
}

use std::collections::HashMap;

use crate::{CaptionDocument, CaptionPage, TimedWord};

fn rounded_milliseconds(microseconds: i64) -> i64 {
    microseconds.max(0).saturating_add(500) / 1_000
}

fn srt_time(microseconds: i64, separator: char) -> String {
    let milliseconds = rounded_milliseconds(microseconds);
    let hours = milliseconds / 3_600_000;
    let minutes = milliseconds % 3_600_000 / 60_000;
    let seconds = milliseconds % 60_000 / 1_000;
    let remainder = milliseconds % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{remainder:03}")
}

fn page_text(page: &CaptionPage, words: &HashMap<&str, &TimedWord>) -> String {
    page.display_text_override.clone().unwrap_or_else(|| {
        page.word_ids
            .iter()
            .filter_map(|id| words.get(id.as_str()))
            .map(|word| word.display_text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    })
}

pub fn export_srt(document: &CaptionDocument) -> String {
    let words: HashMap<_, _> = document
        .words
        .iter()
        .map(|word| (word.id.as_str(), word))
        .collect();
    let mut pages: Vec<_> = document.pages.iter().collect();
    pages.sort_by_key(|page| (page.start_us, page.end_us));
    let mut output = String::new();
    let mut previous_end_ms = 0;
    for (index, page) in pages.into_iter().enumerate() {
        let start_ms = rounded_milliseconds(page.start_us).max(previous_end_ms);
        let end_ms = rounded_milliseconds(page.end_us).max(start_ms + 1);
        previous_end_ms = end_ms;
        output.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            srt_time(start_ms * 1_000, ','),
            srt_time(end_ms * 1_000, ','),
            page_text(page, &words)
        ));
    }
    output
}

pub fn export_vtt(document: &CaptionDocument) -> String {
    export_srt(document)
        .lines()
        .filter(|line| line.parse::<usize>().is_err())
        .map(|line| line.replace(',', "."))
        .fold(String::from("WEBVTT\n\n"), |mut output, line| {
            output.push_str(&line);
            output.push('\n');
            output
        })
}

pub fn microseconds_to_frame(
    microseconds: i64,
    frame_rate_numerator: u32,
    frame_rate_denominator: u32,
) -> Option<i64> {
    if frame_rate_numerator == 0 || frame_rate_denominator == 0 {
        return None;
    }
    let numerator = microseconds as i128 * frame_rate_numerator as i128;
    let denominator = 1_000_000_i128 * frame_rate_denominator as i128;
    let rounded = if numerator >= 0 {
        (numerator + denominator / 2) / denominator
    } else {
        (numerator - denominator / 2) / denominator
    };
    i64::try_from(rounded).ok()
}

#[cfg(test)]
mod tests {
    use crate::{CaptionPage, TimedWord, TimingDiagnostics, TimingSource};

    use super::*;

    #[test]
    fn exports_milliseconds_without_cumulative_drift_and_keeps_gaps() {
        let document = CaptionDocument {
            version: "capinsta.caption.v2".to_owned(),
            media_duration_us: 10_000_000,
            timeline_offset_us: 0,
            words: vec![
                TimedWord {
                    id: "a".to_owned(),
                    spoken_text: "A".to_owned(),
                    display_text: "A".to_owned(),
                    start_us: 1_000_499,
                    end_us: 4_000_499,
                    confidence: None,
                    timing_source: TimingSource::Provider,
                    timing_needs_review: false,
                    provider: None,
                    speaker_id: None,
                    language: None,
                    vad_segment_id: None,
                    timing_diagnostic: None,
                },
                TimedWord {
                    id: "b".to_owned(),
                    spoken_text: "B".to_owned(),
                    display_text: "B".to_owned(),
                    start_us: 6_500_499,
                    end_us: 7_000_499,
                    confidence: None,
                    timing_source: TimingSource::Provider,
                    timing_needs_review: false,
                    provider: None,
                    speaker_id: None,
                    language: None,
                    vad_segment_id: None,
                    timing_diagnostic: None,
                },
            ],
            pages: vec![
                CaptionPage {
                    id: "p1".to_owned(),
                    word_ids: vec!["a".to_owned()],
                    start_us: 1_000_499,
                    end_us: 4_250_499,
                    display_text_override: None,
                    active_word_effects_enabled: true,
                },
                CaptionPage {
                    id: "p2".to_owned(),
                    word_ids: vec!["b".to_owned()],
                    start_us: 6_500_499,
                    end_us: 7_250_499,
                    display_text_override: None,
                    active_word_effects_enabled: true,
                },
            ],
            vad_regions: vec![],
            diagnostics: TimingDiagnostics::default(),
        };
        let srt = export_srt(&document);
        assert!(srt.contains("00:00:04,250"));
        assert!(srt.contains("00:00:06,500"));
    }

    #[test]
    fn converts_fractional_frame_rates_rationally() {
        assert_eq!(microseconds_to_frame(1_001_000, 30_000, 1_001), Some(30));
        assert_eq!(microseconds_to_frame(1_001_000, 60_000, 1_001), Some(60));
    }
}

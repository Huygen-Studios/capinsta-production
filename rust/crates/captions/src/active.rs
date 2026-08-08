use std::collections::HashMap;

use serde::Serialize;

use crate::{CaptionDocument, CaptionPage, TimedWord, WordId};

#[derive(Clone, Debug)]
pub struct CaptionTimingIndex<'a> {
    pages: Vec<&'a CaptionPage>,
    words: Vec<&'a TimedWord>,
    words_by_id: HashMap<&'a str, &'a TimedWord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCaptionState {
    pub page_id: String,
    pub active_word_ids: Vec<WordId>,
}

impl<'a> CaptionTimingIndex<'a> {
    pub fn new(document: &'a CaptionDocument) -> Self {
        let mut pages: Vec<_> = document.pages.iter().collect();
        pages.sort_by_key(|page| (page.start_us, page.end_us));
        let mut words: Vec<_> = document.words.iter().collect();
        words.sort_by_key(|word| (word.start_us, word.end_us));
        let words_by_id = document
            .words
            .iter()
            .map(|word| (word.id.as_str(), word))
            .collect();
        Self {
            pages,
            words,
            words_by_id,
        }
    }

    fn active_page(&self, playback_time_us: i64) -> Option<&'a CaptionPage> {
        let index = self
            .pages
            .partition_point(|page| page.start_us <= playback_time_us)
            .checked_sub(1)?;
        let page = self.pages[index];
        (playback_time_us < page.end_us).then_some(page)
    }

    pub fn active_state(&self, playback_time_us: i64) -> Option<ActiveCaptionState> {
        let page = self.active_page(playback_time_us)?;
        let active_word_ids = if page.active_word_effects_enabled {
            page.word_ids
                .iter()
                .filter(|id| {
                    self.words_by_id.get(id.as_str()).is_some_and(|word| {
                        !word.timing_needs_review
                            && word.start_us <= playback_time_us
                            && playback_time_us < word.end_us
                    })
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        Some(ActiveCaptionState {
            page_id: page.id.clone(),
            active_word_ids,
        })
    }

    pub fn active_word(&self, playback_time_us: i64) -> Option<&'a TimedWord> {
        let index = self
            .words
            .partition_point(|word| word.start_us <= playback_time_us)
            .checked_sub(1)?;
        let word = self.words[index];
        (!word.timing_needs_review && playback_time_us < word.end_us).then_some(word)
    }
}

#[cfg(test)]
mod tests {
    use crate::{CaptionPage, TimedWord, TimingDiagnostics, TimingSource};

    use super::*;

    fn document() -> CaptionDocument {
        CaptionDocument {
            version: "capinsta.caption.v2".to_owned(),
            media_duration_us: 2_000_000,
            timeline_offset_us: 0,
            words: vec![TimedWord {
                id: "one".to_owned(),
                spoken_text: "one".to_owned(),
                display_text: "one".to_owned(),
                start_us: 1_000_000,
                end_us: 1_200_000,
                confidence: None,
                timing_source: TimingSource::Provider,
                timing_needs_review: false,
                provider: None,
                speaker_id: None,
                language: None,
                vad_segment_id: None,
                timing_diagnostic: None,
            }],
            pages: vec![CaptionPage {
                id: "page".to_owned(),
                word_ids: vec!["one".to_owned()],
                start_us: 1_000_000,
                end_us: 1_450_000,
                display_text_override: None,
                active_word_effects_enabled: true,
            }],
            vad_regions: vec![],
            diagnostics: TimingDiagnostics::default(),
        }
    }

    #[test]
    fn uses_half_open_word_intervals_and_allows_page_hold() {
        let document = document();
        let index = CaptionTimingIndex::new(&document);
        assert_eq!(index.active_word(1_000_000).unwrap().id, "one");
        assert!(index.active_word(1_199_999).is_some());
        assert!(index.active_word(1_200_000).is_none());
        let held = index.active_state(1_300_000).unwrap();
        assert_eq!(held.page_id, "page");
        assert!(held.active_word_ids.is_empty());
    }
}

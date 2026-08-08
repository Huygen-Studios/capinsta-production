use std::collections::HashMap;

use crate::{CaptionDocument, TimingSource};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TextEditOutcome {
    DisplayOnly { updated_words: usize },
    PageTranslation { page_id: String },
    RequiresForcedAlignment { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TimingEditOutcome {
    Shifted { offset_us: i64 },
    RequiresForcedAlignment { reason: String },
}

pub fn apply_display_text_edits(
    document: &mut CaptionDocument,
    replacements: &HashMap<String, String>,
) -> TextEditOutcome {
    let mut updated = 0;
    for word in &mut document.words {
        if let Some(display_text) = replacements.get(&word.id) {
            word.display_text = display_text.clone();
            updated += 1;
        }
    }
    TextEditOutcome::DisplayOnly {
        updated_words: updated,
    }
}

pub fn apply_page_translation(
    document: &mut CaptionDocument,
    page_id: &str,
    translated_text: String,
) -> TextEditOutcome {
    if let Some(page) = document.pages.iter_mut().find(|page| page.id == page_id) {
        page.display_text_override = Some(translated_text);
        // A page-level translation has no trustworthy target-word mapping.
        page.active_word_effects_enabled = false;
    }
    TextEditOutcome::PageTranslation {
        page_id: page_id.to_owned(),
    }
}

pub fn apply_page_text_edit(
    document: &mut CaptionDocument,
    page_id: &str,
    edited_text: &str,
) -> TextEditOutcome {
    let Some(page_index) = document.pages.iter().position(|page| page.id == page_id) else {
        return TextEditOutcome::RequiresForcedAlignment {
            reason: "caption page was not found".to_owned(),
        };
    };
    let word_ids = document.pages[page_index].word_ids.clone();
    let tokens: Vec<_> = edited_text.split_whitespace().collect();
    if tokens.len() == word_ids.len() {
        let replacements: HashMap<_, _> = word_ids
            .into_iter()
            .zip(tokens.into_iter().map(str::to_owned))
            .collect();
        return apply_display_text_edits(document, &replacements);
    }
    document.pages[page_index].display_text_override = Some(edited_text.to_owned());
    document.pages[page_index].active_word_effects_enabled = false;
    for word in &mut document.words {
        if document.pages[page_index].word_ids.contains(&word.id) {
            word.timing_needs_review = true;
            word.timing_diagnostic =
                Some("caption token count changed; forced realignment required".to_owned());
        }
    }
    TextEditOutcome::RequiresForcedAlignment {
        reason: "caption token count changed".to_owned(),
    }
}

pub fn replace_spoken_tokens(
    document: &mut CaptionDocument,
    replacement_tokens: &[String],
) -> TextEditOutcome {
    if replacement_tokens.len() != document.words.len() {
        for word in &mut document.words {
            word.timing_needs_review = true;
            if word.timing_source != TimingSource::Estimated {
                word.timing_diagnostic =
                    Some("spoken token count changed; forced realignment required".to_owned());
            }
        }
        for page in &mut document.pages {
            page.active_word_effects_enabled = false;
        }
        return TextEditOutcome::RequiresForcedAlignment {
            reason: "spoken token count changed".to_owned(),
        };
    }
    for (word, replacement) in document.words.iter_mut().zip(replacement_tokens) {
        word.spoken_text = replacement.clone();
    }
    TextEditOutcome::RequiresForcedAlignment {
        reason: "spoken token identity changed".to_owned(),
    }
}

pub fn edit_page_timing(
    document: &mut CaptionDocument,
    page_id: &str,
    start_us: i64,
    end_us: i64,
    duration_tolerance_us: i64,
) -> TimingEditOutcome {
    let Some(page_index) = document.pages.iter().position(|page| page.id == page_id) else {
        return TimingEditOutcome::RequiresForcedAlignment {
            reason: "caption page was not found".to_owned(),
        };
    };
    if start_us < 0 || end_us <= start_us || end_us > document.media_duration_us {
        return TimingEditOutcome::RequiresForcedAlignment {
            reason: "caption timing is outside the media range".to_owned(),
        };
    }
    let old_duration = document.pages[page_index].end_us - document.pages[page_index].start_us;
    let new_duration = end_us - start_us;
    let offset_us = start_us - document.pages[page_index].start_us;
    let word_ids = document.pages[page_index].word_ids.clone();
    document.pages[page_index].start_us = start_us;
    document.pages[page_index].end_us = end_us;
    if (old_duration - new_duration).abs() <= duration_tolerance_us.max(0) {
        for word in &mut document.words {
            if word_ids.contains(&word.id) {
                word.start_us = word.start_us.saturating_add(offset_us);
                word.end_us = word.end_us.saturating_add(offset_us);
                word.timing_source = TimingSource::Manual;
            }
        }
        TimingEditOutcome::Shifted { offset_us }
    } else {
        document.pages[page_index].active_word_effects_enabled = false;
        for word in &mut document.words {
            if word_ids.contains(&word.id) {
                word.timing_needs_review = true;
                word.timing_diagnostic =
                    Some("caption duration changed; forced realignment required".to_owned());
            }
        }
        TimingEditOutcome::RequiresForcedAlignment {
            reason: "caption duration changed".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::{CaptionPage, TimedWord, TimingDiagnostics};

    use super::*;

    fn document() -> CaptionDocument {
        CaptionDocument {
            version: "capinsta.caption.v2".to_owned(),
            media_duration_us: 1_000_000,
            timeline_offset_us: 0,
            words: vec![TimedWord {
                id: "w1".to_owned(),
                spoken_text: "namaste".to_owned(),
                display_text: "नमस्ते".to_owned(),
                start_us: 100_000,
                end_us: 400_000,
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
                id: "p1".to_owned(),
                word_ids: vec!["w1".to_owned()],
                start_us: 100_000,
                end_us: 650_000,
                display_text_override: None,
                active_word_effects_enabled: true,
            }],
            vad_regions: vec![],
            diagnostics: TimingDiagnostics::default(),
        }
    }

    #[test]
    fn spelling_and_transliteration_preserve_timing() {
        let mut document = document();
        let before = (document.words[0].start_us, document.words[0].end_us);
        apply_display_text_edits(
            &mut document,
            &HashMap::from([("w1".to_owned(), "Namaste".to_owned())]),
        );
        assert_eq!(
            before,
            (document.words[0].start_us, document.words[0].end_us)
        );
        assert_eq!(document.words[0].display_text, "Namaste");
    }

    #[test]
    fn non_one_to_one_translation_has_no_fake_active_word_timing() {
        let mut document = document();
        apply_page_translation(&mut document, "p1", "Hello, everyone".to_owned());
        assert_eq!(
            document.pages[0].display_text_override.as_deref(),
            Some("Hello, everyone")
        );
        assert!(!document.pages[0].active_word_effects_enabled);
    }

    #[test]
    fn spoken_token_change_requires_realigning() {
        let mut document = document();
        let outcome =
            replace_spoken_tokens(&mut document, &["hello".to_owned(), "there".to_owned()]);
        assert!(matches!(
            outcome,
            TextEditOutcome::RequiresForcedAlignment { .. }
        ));
        assert!(document.words[0].timing_needs_review);
        assert!(!document.pages[0].active_word_effects_enabled);
    }
}

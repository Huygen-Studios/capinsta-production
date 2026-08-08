use serde::{Deserialize, Serialize};

pub const MICROSECONDS_PER_SECOND: i64 = 1_000_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct CaptionTimingConfig {
    pub pause_threshold_us: i64,
    pub post_word_hold_us: i64,
    pub max_words_per_page: usize,
    pub max_chars_per_line: usize,
    pub max_page_duration_us: i64,
    pub min_word_duration_us: i64,
    pub tiny_overlap_tolerance_us: i64,
    pub forced_alignment_confidence_threshold: f32,
    pub use_vad: bool,
    pub adaptive_pause_threshold: bool,
    pub allow_estimated_active_words: bool,
}

impl Default for CaptionTimingConfig {
    fn default() -> Self {
        Self {
            pause_threshold_us: 360_000,
            post_word_hold_us: 250_000,
            max_words_per_page: 4,
            max_chars_per_line: 34,
            max_page_duration_us: 3_000_000,
            min_word_duration_us: 40_000,
            tiny_overlap_tolerance_us: 20_000,
            forced_alignment_confidence_threshold: 0.55,
            use_vad: true,
            adaptive_pause_threshold: true,
            allow_estimated_active_words: false,
        }
    }
}

impl CaptionTimingConfig {
    pub fn normalized(mut self) -> Self {
        self.pause_threshold_us = self.pause_threshold_us.clamp(50_000, 2_000_000);
        self.post_word_hold_us = self.post_word_hold_us.clamp(150_000, 350_000);
        self.max_words_per_page = self.max_words_per_page.clamp(1, 20);
        self.max_chars_per_line = self.max_chars_per_line.clamp(4, 200);
        self.max_page_duration_us = self.max_page_duration_us.clamp(250_000, 15_000_000);
        self.min_word_duration_us = self.min_word_duration_us.clamp(10_000, 500_000);
        self.tiny_overlap_tolerance_us = self.tiny_overlap_tolerance_us.clamp(0, 100_000);
        self.forced_alignment_confidence_threshold =
            self.forced_alignment_confidence_threshold.clamp(0.0, 1.0);
        self
    }
}

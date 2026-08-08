use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub type WordId = String;
pub type CaptionPageId = String;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimingSource {
    #[default]
    Provider,
    ForcedAlignment,
    RepairedProvider,
    Manual,
    Estimated,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedWord {
    pub id: WordId,
    pub spoken_text: String,
    pub display_text: String,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    #[serde(default)]
    pub timing_source: TimingSource,
    #[serde(default)]
    pub timing_needs_review: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vad_segment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_diagnostic: Option<String>,
}

impl TimedWord {
    pub fn active_word_effects_enabled(&self, allow_estimated: bool) -> bool {
        !self.timing_needs_review
            && (self.timing_source != TimingSource::Estimated || allow_estimated)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptionPage {
    pub id: CaptionPageId,
    pub word_ids: Vec<WordId>,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_text_override: Option<String>,
    #[serde(default = "default_true")]
    pub active_word_effects_enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VadRegionKind {
    Speech,
    Silence,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VadRegion {
    pub id: String,
    pub kind: VadRegionKind,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct TimingDiagnostics {
    pub decoded_duration_us: i64,
    pub normalized_sample_count: u64,
    pub provider_duration_us: i64,
    pub timeline_offset_us: i64,
    pub provider_word_count: usize,
    pub repaired_word_count: usize,
    pub forced_aligned_word_count: usize,
    pub estimated_word_count: usize,
    pub vad_speech_duration_us: i64,
    pub vad_silence_duration_us: i64,
    pub maximum_timing_drift_us: i64,
    #[serde(default)]
    pub validation_failures: Vec<ValidationFailure>,
    #[serde(default)]
    pub counters: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationFailure {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_id: Option<WordId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_us: Option<i64>,
    pub requires_forced_alignment: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptionDocument {
    #[serde(default = "caption_document_version")]
    pub version: String,
    pub media_duration_us: i64,
    #[serde(default)]
    pub timeline_offset_us: i64,
    pub words: Vec<TimedWord>,
    #[serde(default)]
    pub pages: Vec<CaptionPage>,
    #[serde(default)]
    pub vad_regions: Vec<VadRegion>,
    #[serde(default)]
    pub diagnostics: TimingDiagnostics,
}

pub fn caption_document_version() -> String {
    "capinsta.caption.v2".to_owned()
}

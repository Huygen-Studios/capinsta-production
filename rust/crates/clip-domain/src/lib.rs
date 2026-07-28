//! Non-destructive ClipProjectV1 contract. Source times are integer milliseconds.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
mod edl;
pub use edl::*;
mod transcript_remap;
pub use transcript_remap::*;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMediaReferenceV1 {
    pub media_id: String,
    pub duration_ms: i64,
    pub source_type: SourceType,
    pub display_name: Option<String>,
    pub mime_type: Option<String>,
    pub storage_key: Option<String>,
    pub checksum: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSelectionReferenceV1 {
    pub transcript_id: Option<String>,
    pub transcript_revision: Option<u64>,
    pub start_word_id: Option<String>,
    pub end_word_id: Option<String>,
    pub start_segment_id: Option<String>,
    pub end_segment_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipBoundaryV1 {
    #[serde(default)]
    pub pre_roll_ms: i64,
    #[serde(default)]
    pub post_roll_ms: i64,
    #[serde(default)]
    pub start_adjusted_manually: bool,
    #[serde(default)]
    pub end_adjusted_manually: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRangeV1 {
    pub schema_version: u8,
    pub id: String,
    pub source_media_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub order: u64,
    #[serde(default = "one")]
    pub playback_rate: f64,
    pub selection: Option<ClipSelectionReferenceV1>,
    #[serde(default)]
    pub boundary: ClipBoundaryV1,
    pub transition_in: Option<Value>,
    pub transition_out: Option<Value>,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub label: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}
fn one() -> f64 {
    1.
}
fn yes() -> bool {
    true
}
impl Default for ClipBoundaryV1 {
    fn default() -> Self {
        Self {
            pre_roll_ms: 0,
            post_roll_ms: 0,
            start_adjusted_manually: false,
            end_adjusted_manually: false,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipCanvasV1 {
    pub aspect_ratio: String,
    pub width: i64,
    pub height: i64,
    pub background: Option<String>,
    pub safe_area: Option<Value>,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrackReferenceV1 {
    pub caption_track_id: String,
    pub transcript_id: Option<String>,
    pub style_preset_id: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipProjectSettingsV1 {
    #[serde(default)]
    pub default_pre_roll_ms: i64,
    #[serde(default)]
    pub default_post_roll_ms: i64,
    #[serde(default = "yes")]
    pub snap_to_words: bool,
    #[serde(default = "yes")]
    pub snap_to_segments: bool,
    #[serde(default = "yes")]
    pub preserve_breathing_room: bool,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipProjectV1 {
    pub schema_version: u8,
    pub clip_project_id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub source_media: SourceMediaReferenceV1,
    pub transcript_id: Option<String>,
    pub transcript_revision: Option<u64>,
    #[serde(default)]
    pub ranges: Vec<ClipRangeV1>,
    pub canvas: ClipCanvasV1,
    pub caption_track: Option<CaptionTrackReferenceV1>,
    #[serde(default)]
    pub settings: ClipProjectSettingsV1,
    pub status: String,
    pub revision: u64,
    #[serde(default)]
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}
impl Default for ClipProjectSettingsV1 {
    fn default() -> Self {
        Self {
            default_pre_roll_ms: 0,
            default_post_roll_ms: 0,
            snap_to_words: true,
            snap_to_segments: true,
            preserve_breathing_room: true,
            metadata: Value::Object(Default::default()),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Uploaded,
    Recorded,
    Imported,
    Generated,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub category: String,
    pub field_path: String,
    pub entity_id: Option<String>,
    pub message: String,
}
impl ClipProjectV1 {
    pub fn validate(&self) -> Result<(), ValidationIssue> {
        if self.schema_version != 1 {
            return Err(issue("invalid_schema_version", "schemaVersion", None));
        }
        if self.clip_project_id.is_empty()
            || self.source_media.media_id.is_empty()
            || self.source_media.duration_ms < 0
        {
            return Err(issue("invalid_timestamp", "sourceMedia", None));
        }
        if self.revision == 0 || self.canvas.width <= 0 || self.canvas.height <= 0 {
            return Err(issue("invalid_canvas", "canvas", None));
        }
        let mut ids = HashSet::new();
        let mut orders = HashSet::new();
        for r in &self.ranges {
            if r.schema_version != 1 {
                return Err(issue(
                    "invalid_schema_version",
                    "ranges.schemaVersion",
                    Some(r.id.clone()),
                ));
            }
            if r.id.is_empty() || r.source_start_ms < 0 {
                return Err(issue(
                    "invalid_timestamp",
                    "ranges.sourceStartMs",
                    Some(r.id.clone()),
                ));
            }
            if r.source_end_ms <= r.source_start_ms {
                return Err(issue(
                    "invalid_range_duration",
                    "ranges",
                    Some(r.id.clone()),
                ));
            }
            if r.source_end_ms > self.source_media.duration_ms {
                return Err(issue(
                    "range_exceeds_media",
                    "ranges.sourceEndMs",
                    Some(r.id.clone()),
                ));
            }
            if r.playback_rate < 0.25 || r.playback_rate > 4. {
                return Err(issue(
                    "invalid_playback_rate",
                    "ranges.playbackRate",
                    Some(r.id.clone()),
                ));
            }
            if r.source_media_id != self.source_media.media_id {
                return Err(issue(
                    "media_reference_mismatch",
                    "ranges.sourceMediaId",
                    Some(r.id.clone()),
                ));
            }
            if !ids.insert(&r.id) {
                return Err(issue("duplicate_range_id", "ranges.id", Some(r.id.clone())));
            }
            if r.enabled && !orders.insert(r.order) {
                return Err(issue(
                    "duplicate_range_order",
                    "ranges.order",
                    Some(r.id.clone()),
                ));
            }
        }
        Ok(())
    }
}
fn issue(category: &str, path: &str, id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        category: category.into(),
        field_path: path.into(),
        entity_id: id,
        message: category.into(),
    }
}
pub fn validate_against_transcript(
    project: &ClipProjectV1,
    transcript: Option<&transcript_domain::TranscriptDocumentV2>,
) -> Vec<ValidationIssue> {
    let Some(transcript) = transcript else {
        return vec![];
    };
    let mut issues = vec![];
    if project
        .transcript_id
        .as_deref()
        .is_some_and(|id| id != transcript.transcript_id)
    {
        issues.push(issue(
            "transcript_reference_missing",
            "transcriptId",
            Some(project.clip_project_id.clone()),
        ))
    }
    let words: HashSet<_> = transcript.words.iter().map(|w| w.id.as_str()).collect();
    let segments: HashSet<_> = transcript.segments.iter().map(|s| s.id.as_str()).collect();
    for range in &project.ranges {
        let Some(selection) = &range.selection else {
            continue;
        };
        for (field, id, set) in [
            ("startWordId", selection.start_word_id.as_ref(), &words),
            ("endWordId", selection.end_word_id.as_ref(), &words),
            (
                "startSegmentId",
                selection.start_segment_id.as_ref(),
                &segments,
            ),
            ("endSegmentId", selection.end_segment_id.as_ref(), &segments),
        ] {
            if id.is_some_and(|id| !set.contains(id.as_str())) {
                issues.push(issue(
                    "transcript_reference_missing",
                    field,
                    Some(range.id.clone()),
                ))
            }
        }
        if selection
            .transcript_revision
            .is_some_and(|v| Some(v) != project.transcript_revision)
        {
            issues.push(issue(
                "transcript_revision_mismatch",
                "selection.transcriptRevision",
                Some(range.id.clone()),
            ))
        }
    }
    issues
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_round_trip() {
        let raw =
            std::fs::read_to_string("../../../contracts/fixtures/clip-project-v1/one-range.json")
                .unwrap();
        let p: ClipProjectV1 = serde_json::from_str(&raw).unwrap();
        p.validate().unwrap();
        let serialized: ClipProjectV1 =
            serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(serialized, p)
    }
}

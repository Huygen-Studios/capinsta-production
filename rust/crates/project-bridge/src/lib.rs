//! Deterministic ClipProjectV1 -> Capinsta project conversion.
//!
//! The emitted project matches Capinsta's persisted version-35 project shape.
//! Contract time remains integer milliseconds; Capinsta timeline fields are
//! integer MediaTime ticks (120 ticks per millisecond).

use clip_domain::{
    ClipProjectV1, EditDecisionListV1, EdlEntryV1, RemappedTranscriptV1, RemappedWordOccurrenceV1,
    generate_edit_decision_list,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use transcript_domain::TimingSource;

pub const CONVERSION_SCHEMA_VERSION: u8 = 1;
pub const CAPINSTA_PROJECT_VERSION: u8 = 35;
pub const TICKS_PER_MILLISECOND: i64 = 120;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnsupportedFeaturePolicy {
    Error,
    Warn,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipProjectConversionOptionsV1 {
    pub include_captions: bool,
    pub preserve_disabled_ranges: bool,
    pub create_separate_tracks: bool,
    pub unsupported_feature_policy: UnsupportedFeaturePolicy,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipProjectConversionInputV1 {
    pub schema_version: u8,
    pub clip_project: ClipProjectV1,
    pub edit_decision_list: EditDecisionListV1,
    pub remapped_transcript: Option<RemappedTranscriptV1>,
    pub target_project_id: String,
    pub target_project_version: u8,
    pub options: ClipProjectConversionOptionsV1,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectConversionSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConversionIssue {
    pub category: String,
    pub severity: ProjectConversionSeverity,
    pub message: String,
    pub field_path: Option<String>,
    pub clip_project_id: Option<String>,
    pub project_revision: Option<u64>,
    pub range_id: Option<String>,
    pub edl_entry_id: Option<String>,
    pub target_project_id: Option<String>,
    pub timeline_element_id: Option<String>,
    pub caption_occurrence_id: Option<String>,
    #[serde(default)]
    pub timing_values: BTreeMap<String, i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaProjectConversionResultV1 {
    pub schema_version: u8,
    pub source_clip_project_id: String,
    pub source_clip_project_revision: u64,
    pub target_project_id: String,
    pub project: CapinstaProjectV35,
    pub media_reference: CapinstaMediaReferenceV1,
    pub mapping: ProjectConversionMappingV1,
    pub warnings: Vec<ProjectConversionIssue>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConversionMappingV1 {
    pub source_media_id: String,
    pub capinsta_media_id: String,
    pub range_mappings: Vec<RangeMappingV1>,
    pub caption_mappings: Vec<CaptionMappingV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeMappingV1 {
    pub range_id: String,
    pub edl_entry_id: String,
    pub timeline_element_ids: Vec<String>,
    pub track_ids: Vec<String>,
    pub source_media_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub source_duration_ms: i64,
    pub timeline_start_ms: i64,
    pub timeline_end_ms: i64,
    pub output_duration_ms: i64,
    pub playback_rate: f64,
    pub order: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionMappingV1 {
    pub segment_occurrence_id: String,
    pub caption_element_id: String,
    pub source_word_occurrence_ids: Vec<String>,
    pub caption_word_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaMediaReferenceV1 {
    pub media_id: String,
    pub source_asset_id: String,
    pub display_name: String,
    pub mime_type: Option<String>,
    pub duration_ms: i64,
    pub requires_media_attachment: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaProjectV35 {
    pub metadata: CapinstaProjectMetadataV35,
    pub scenes: Vec<CapinstaSceneV35>,
    pub current_scene_id: String,
    pub settings: CapinstaProjectSettingsV35,
    pub version: u8,
    pub timeline_view_state: CapinstaTimelineViewStateV35,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capinsta_caption_documents: Option<Vec<CapinstaCaptionDocumentRecordV35>>,
    pub capinsta_clipping_provenance: CapinstaClippingProvenanceV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaProjectMetadataV35 {
    pub id: String,
    pub name: String,
    pub duration: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaSceneV35 {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub tracks: CapinstaSceneTracksV35,
    pub bookmarks: Vec<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaSceneTracksV35 {
    pub overlay: Vec<CapinstaOverlayTrackV35>,
    pub main: CapinstaVideoTrackV35,
    pub audio: Vec<CapinstaAudioTrackV35>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CapinstaOverlayTrackV35 {
    Text(CapinstaTextTrackV35),
    Video(CapinstaVideoTrackV35),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaVideoTrackV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub elements: Vec<CapinstaVideoElementV35>,
    pub muted: bool,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaAudioTrackV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub elements: Vec<CapinstaAudioElementV35>,
    pub muted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaTextTrackV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub elements: Vec<CapinstaTextElementV35>,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaRetimeV35 {
    pub rate: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maintain_pitch: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaVideoElementV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub element_type: String,
    pub media_id: String,
    pub duration: i64,
    pub start_time: i64,
    pub trim_start: i64,
    pub trim_end: i64,
    pub source_duration: i64,
    pub is_source_audio_enabled: bool,
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retime: Option<CapinstaRetimeV35>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masks: Option<Value>,
    pub params: Value,
    pub source_asset_id: String,
    pub clipping_range_id: String,
    pub clipping_edl_entry_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaAudioElementV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub element_type: String,
    pub source_type: String,
    pub media_id: String,
    pub duration: i64,
    pub start_time: i64,
    pub trim_start: i64,
    pub trim_end: i64,
    pub source_duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retime: Option<CapinstaRetimeV35>,
    pub params: Value,
    pub source_asset_id: String,
    pub clipping_range_id: String,
    pub clipping_edl_entry_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaTextElementV35 {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub element_type: String,
    pub duration: i64,
    pub start_time: i64,
    pub trim_start: i64,
    pub trim_end: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub params: Value,
    pub capinsta_document_id: String,
    pub capinsta_clip_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaProjectSettingsV35 {
    pub fps: CapinstaFrameRateV35,
    pub canvas_size: CapinstaCanvasSizeV35,
    pub canvas_size_mode: String,
    pub last_custom_canvas_size: Option<CapinstaCanvasSizeV35>,
    pub original_canvas_size: Option<CapinstaCanvasSizeV35>,
    pub background: CapinstaBackgroundV35,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CapinstaFrameRateV35 {
    pub numerator: u32,
    pub denominator: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CapinstaCanvasSizeV35 {
    pub width: i64,
    pub height: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CapinstaBackgroundV35 {
    #[serde(rename = "type")]
    pub background_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur_intensity: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaTimelineViewStateV35 {
    pub zoom_level: f64,
    pub scroll_left: f64,
    pub playhead_time: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaClippingProvenanceV1 {
    pub source_application: String,
    pub source_clip_project_id: String,
    pub source_clip_project_revision: u64,
    pub source_transcript_id: Option<String>,
    pub conversion_schema_version: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaCaptionDocumentRecordV35 {
    pub document: CapinstaCaptionDocumentV35,
    pub open_cut_track_id: String,
    pub imported_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaCaptionDocumentV35 {
    pub id: String,
    pub track_id: String,
    pub source_transcript_ref: Value,
    pub duration_seconds: f64,
    pub language_mode: String,
    pub style_preset_id: String,
    pub clips: Vec<CapinstaCaptionClipV35>,
    pub words: Vec<CapinstaCaptionWordV35>,
    pub manual_edits: Value,
    pub timing: Value,
    pub canonical_timing: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaCaptionClipV35 {
    pub id: String,
    pub track_id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub word_ids: Vec<String>,
    pub style_preset_id: String,
    pub selected: bool,
    pub editable: bool,
    pub manually_edited: bool,
    pub timing_needs_review: bool,
    pub timing_source: String,
    pub source_clip_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_overrides: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_edit: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapinstaCaptionWordV35 {
    pub id: String,
    pub text: String,
    pub displayed_text: String,
    pub start: f64,
    pub end: f64,
    pub timing_source: String,
    pub original_text: Option<String>,
    pub confidence: Option<f64>,
    pub language_hint: Option<String>,
    pub timing_source_detail: String,
    pub timing_needs_review: bool,
    pub source_word_id: String,
}

fn issue(
    input: &ClipProjectConversionInputV1,
    category: &str,
    severity: ProjectConversionSeverity,
    message: impl Into<String>,
    field_path: Option<&str>,
) -> ProjectConversionIssue {
    ProjectConversionIssue {
        category: category.into(),
        severity,
        message: message.into(),
        field_path: field_path.map(str::to_owned),
        clip_project_id: Some(input.clip_project.clip_project_id.clone()),
        project_revision: Some(input.clip_project.revision),
        range_id: None,
        edl_entry_id: None,
        target_project_id: Some(input.target_project_id.clone()),
        timeline_element_id: None,
        caption_occurrence_id: None,
        timing_values: BTreeMap::new(),
    }
}

fn warning(
    input: &ClipProjectConversionInputV1,
    category: &str,
    message: impl Into<String>,
    field_path: Option<&str>,
) -> ProjectConversionIssue {
    issue(
        input,
        category,
        ProjectConversionSeverity::Warning,
        message,
        field_path,
    )
}

fn checked_ticks(
    input: &ClipProjectConversionInputV1,
    milliseconds: i64,
    field_path: &str,
) -> Result<i64, Vec<ProjectConversionIssue>> {
    milliseconds
        .checked_mul(TICKS_PER_MILLISECOND)
        .ok_or_else(|| {
            vec![issue(
                input,
                "arithmetic_overflow",
                ProjectConversionSeverity::Error,
                "millisecond value cannot be represented as Capinsta ticks",
                Some(field_path),
            )]
        })
}

fn validate_input(input: &ClipProjectConversionInputV1) -> Vec<ProjectConversionIssue> {
    let mut issues = Vec::new();
    if input.schema_version != CONVERSION_SCHEMA_VERSION || input.target_project_id.is_empty() {
        issues.push(issue(
            input,
            "invalid_conversion_input",
            ProjectConversionSeverity::Error,
            "conversion schema version and target project ID must be valid",
            Some("schemaVersion"),
        ));
    }
    if input.target_project_version != CAPINSTA_PROJECT_VERSION {
        issues.push(issue(
            input,
            "unsupported_capinsta_project_version",
            ProjectConversionSeverity::Error,
            format!(
                "project version {} is unsupported; expected {}",
                input.target_project_version, CAPINSTA_PROJECT_VERSION
            ),
            Some("targetProjectVersion"),
        ));
    }
    if let Err(problem) = input.clip_project.validate() {
        let category = match problem.category.as_str() {
            "invalid_playback_rate" => "unsupported_playback_rate",
            "invalid_canvas" => "unsupported_canvas",
            _ => "invalid_conversion_input",
        };
        issues.push(issue(
            input,
            category,
            ProjectConversionSeverity::Error,
            problem.message,
            Some(&problem.field_path),
        ));
    }
    let edl = &input.edit_decision_list;
    if edl.schema_version != 1 {
        issues.push(issue(
            input,
            "invalid_conversion_input",
            ProjectConversionSeverity::Error,
            "EDL schema version must equal 1",
            Some("editDecisionList.schemaVersion"),
        ));
    }
    if edl.clip_project_id != input.clip_project.clip_project_id {
        issues.push(issue(
            input,
            "clip_project_edl_mismatch",
            ProjectConversionSeverity::Error,
            "EDL clip project ID does not match",
            Some("editDecisionList.clipProjectId"),
        ));
    }
    if edl.project_revision != input.clip_project.revision {
        issues.push(issue(
            input,
            "project_revision_mismatch",
            ProjectConversionSeverity::Error,
            "EDL project revision does not match",
            Some("editDecisionList.projectRevision"),
        ));
    }
    if edl.source_media_id != input.clip_project.source_media.media_id
        || edl.source_duration_ms != input.clip_project.source_media.duration_ms
    {
        issues.push(issue(
            input,
            "source_media_mismatch",
            ProjectConversionSeverity::Error,
            "EDL source media does not match the clip project",
            Some("editDecisionList.sourceMediaId"),
        ));
    }
    if input.options.preserve_disabled_ranges {
        issues.push(issue(
            input,
            "invalid_conversion_input",
            ProjectConversionSeverity::Error,
            "preserving disabled ranges is not supported by conversion V1",
            Some("options.preserveDisabledRanges"),
        ));
    }
    if input.options.create_separate_tracks {
        issues.push(issue(
            input,
            "invalid_conversion_input",
            ProjectConversionSeverity::Error,
            "separate range tracks are not supported by conversion V1",
            Some("options.createSeparateTracks"),
        ));
    }
    if issues.is_empty() {
        match generate_edit_decision_list(&input.clip_project) {
            Ok(expected) if expected == *edl => {}
            Ok(expected) if expected.output_duration_ms != edl.output_duration_ms => {
                let mut mismatch = issue(
                    input,
                    "invalid_timeline_duration",
                    ProjectConversionSeverity::Error,
                    "EDL output duration does not match the authoritative EDL",
                    Some("editDecisionList.outputDurationMs"),
                );
                mismatch.timing_values.insert(
                    "expectedOutputDurationMs".into(),
                    expected.output_duration_ms,
                );
                mismatch
                    .timing_values
                    .insert("actualOutputDurationMs".into(), edl.output_duration_ms);
                issues.push(mismatch);
            }
            Ok(_) => issues.push(issue(
                input,
                "timeline_mapping_mismatch",
                ProjectConversionSeverity::Error,
                "EDL entries do not match the authoritative clip-domain result",
                Some("editDecisionList.entries"),
            )),
            Err(problems) => {
                for problem in problems {
                    issues.push(issue(
                        input,
                        &problem.category,
                        ProjectConversionSeverity::Error,
                        problem.message,
                        Some(&problem.field_path),
                    ));
                }
            }
        }
    }
    if let Some(transcript) = &input.remapped_transcript {
        if transcript.clip_project_id != input.clip_project.clip_project_id {
            issues.push(issue(
                input,
                "caption_mapping_mismatch",
                ProjectConversionSeverity::Error,
                "remapped transcript clip project ID does not match",
                Some("remappedTranscript.clipProjectId"),
            ));
        }
        if transcript.project_revision != input.clip_project.revision {
            issues.push(issue(
                input,
                "project_revision_mismatch",
                ProjectConversionSeverity::Error,
                "remapped transcript revision does not match",
                Some("remappedTranscript.projectRevision"),
            ));
        }
        if transcript.source_media_id != input.clip_project.source_media.media_id {
            issues.push(issue(
                input,
                "source_media_mismatch",
                ProjectConversionSeverity::Error,
                "remapped transcript source media does not match",
                Some("remappedTranscript.sourceMediaId"),
            ));
        }
        if transcript.output_duration_ms != edl.output_duration_ms {
            issues.push(issue(
                input,
                "caption_mapping_mismatch",
                ProjectConversionSeverity::Error,
                "remapped transcript duration does not match the EDL",
                Some("remappedTranscript.outputDurationMs"),
            ));
        }
        validate_caption_references(input, transcript, &mut issues);
    }
    issues
}

fn validate_caption_references(
    input: &ClipProjectConversionInputV1,
    transcript: &RemappedTranscriptV1,
    issues: &mut Vec<ProjectConversionIssue>,
) {
    let mut word_ids = HashSet::new();
    for word in &transcript.words {
        if !word_ids.insert(word.occurrence_id.as_str()) {
            let mut problem = issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "duplicate remapped word occurrence ID",
                Some("remappedTranscript.words.occurrenceId"),
            );
            problem.caption_occurrence_id = Some(word.occurrence_id.clone());
            issues.push(problem);
        }
        match (word.output_start_ms, word.output_end_ms) {
            (Some(start), Some(end))
                if start >= 0 && end >= start && end <= transcript.output_duration_ms => {}
            (None, None) => {}
            _ => {
                let mut problem = issue(
                    input,
                    "caption_mapping_mismatch",
                    ProjectConversionSeverity::Error,
                    "caption word timing is invalid or exceeds project duration",
                    Some("remappedTranscript.words"),
                );
                problem.caption_occurrence_id = Some(word.occurrence_id.clone());
                issues.push(problem);
            }
        }
    }
    let mut segment_ids = HashSet::new();
    for segment in &transcript.segments {
        if !segment_ids.insert(segment.occurrence_id.as_str()) {
            let mut problem = issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "duplicate remapped segment occurrence ID",
                Some("remappedTranscript.segments.occurrenceId"),
            );
            problem.caption_occurrence_id = Some(segment.occurrence_id.clone());
            issues.push(problem);
        }
        if segment
            .word_occurrence_ids
            .iter()
            .any(|id| !word_ids.contains(id.as_str()))
        {
            let mut problem = issue(
                input,
                "caption_mapping_mismatch",
                ProjectConversionSeverity::Error,
                "caption segment references a missing word occurrence",
                Some("remappedTranscript.segments.wordOccurrenceIds"),
            );
            problem.caption_occurrence_id = Some(segment.occurrence_id.clone());
            issues.push(problem);
        }
        match (segment.output_start_ms, segment.output_end_ms) {
            (Some(start), Some(end))
                if start >= 0 && end >= start && end <= transcript.output_duration_ms => {}
            (None, None) => {}
            _ => {
                let mut problem = issue(
                    input,
                    "caption_mapping_mismatch",
                    ProjectConversionSeverity::Error,
                    "caption segment timing is invalid or exceeds project duration",
                    Some("remappedTranscript.segments"),
                );
                problem.caption_occurrence_id = Some(segment.occurrence_id.clone());
                issues.push(problem);
            }
        }
    }
}

fn video_params() -> Value {
    json!({
        "transform.positionX": 0,
        "transform.positionY": 0,
        "transform.scaleX": 1,
        "transform.scaleY": 1,
        "transform.rotate": 0,
        "opacity": 1,
        "blendMode": "normal",
        "volume": 0
    })
}

fn text_params(text: &str) -> Value {
    json!({
        "content": text,
        "fontSize": 15,
        "fontFamily": "Arial",
        "color": "#ffffff",
        "textAlign": "center",
        "fontWeight": "normal",
        "fontStyle": "normal",
        "textDecoration": "none",
        "letterSpacing": 0,
        "lineHeight": 1.2,
        "background.enabled": false,
        "background.color": "#000000",
        "background.cornerRadius": 0,
        "background.paddingX": 30,
        "background.paddingY": 42,
        "background.offsetX": 0,
        "background.offsetY": 0,
        "transform.positionX": 0,
        "transform.positionY": 0,
        "transform.scaleX": 1,
        "transform.scaleY": 1,
        "transform.rotate": 0,
        "opacity": 1,
        "blendMode": "normal"
    })
}

fn automatic_clipper(project: &ClipProjectV1) -> Option<&Map<String, Value>> {
    project
        .metadata
        .get("automaticClipper")
        .and_then(Value::as_object)
}

fn automatic_reframe(project: &ClipProjectV1) -> Option<&Map<String, Value>> {
    automatic_clipper(project)?
        .get("reframePlan")
        .and_then(Value::as_object)
}

fn first_reframe_strategy(project: &ClipProjectV1) -> Option<&str> {
    automatic_reframe(project)?
        .get("shots")?
        .as_array()?
        .first()?
        .get("strategy")?
        .as_str()
}

fn uses_blurred_background(project: &ClipProjectV1) -> bool {
    matches!(
        first_reframe_strategy(project),
        Some("fit_blurred_background" | "dual_subject_split" | "speaker_screen_stack")
    )
}

fn reframe_params_and_animations(
    input: &ClipProjectConversionInputV1,
    entry: &EdlEntryV1,
) -> (Value, Option<Value>) {
    let Some(plan) = automatic_reframe(&input.clip_project) else {
        return (video_params(), None);
    };
    let source_width = plan
        .get("sourceWidth")
        .and_then(Value::as_f64)
        .unwrap_or(input.clip_project.canvas.width as f64);
    let source_height = plan
        .get("sourceHeight")
        .and_then(Value::as_f64)
        .unwrap_or(input.clip_project.canvas.height as f64);
    let target_width = input.clip_project.canvas.width as f64;
    let target_height = input.clip_project.canvas.height as f64;
    let contain = (target_width / source_width).min(target_height / source_height);
    let cover_scale =
        ((target_width / source_width).max(target_height / source_height) / contain).max(1.0);
    let keyframes: Vec<_> = plan
        .get("shots")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|shot| {
            shot.get("cropKeyframes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|keyframe| {
            let source_time = keyframe.get("sourceTimeMs")?.as_i64()?;
            if source_time < entry.source_start_ms || source_time > entry.source_end_ms {
                return None;
            }
            Some((
                keyframe.get("id")?.as_str()?.to_owned(),
                ((source_time - entry.source_start_ms) as f64 / entry.playback_rate).round() as i64,
                keyframe.get("centerX")?.as_f64()?,
                keyframe.get("centerY")?.as_f64()?,
                keyframe.get("scale").and_then(Value::as_f64).unwrap_or(1.0),
            ))
        })
        .collect();
    if keyframes.is_empty() {
        return (video_params(), None);
    }
    let (_, _, first_x, first_y, first_scale) = &keyframes[0];
    let scale = cover_scale * first_scale;
    let scaled_width = source_width * contain * scale;
    let scaled_height = source_height * contain * scale;
    let x_limits = (
        (target_width - scaled_width) / 2.0,
        (scaled_width - target_width) / 2.0,
    );
    let y_limits = (
        (target_height - scaled_height) / 2.0,
        (scaled_height - target_height) / 2.0,
    );
    let position_x = ((0.5 - first_x) * scaled_width).clamp(x_limits.0, x_limits.1);
    let position_y = ((0.5 - first_y) * scaled_height).clamp(y_limits.0, y_limits.1);
    let mut params = video_params();
    params["transform.positionX"] = json!(position_x);
    params["transform.positionY"] = json!(position_y);
    params["transform.scaleX"] = json!(scale);
    params["transform.scaleY"] = json!(scale);
    let channel = |suffix: &str, values: Vec<(String, i64, f64)>| {
        json!({
            "keys": values.into_iter().map(|(id, milliseconds, value)| json!({
                "id": format!("{id}_{suffix}"),
                "time": milliseconds * TICKS_PER_MILLISECOND,
                "value": value,
                "segmentToNext": "linear",
                "tangentMode": "auto"
            })).collect::<Vec<_>>(),
            "extrapolation": {"before": "hold", "after": "hold"}
        })
    };
    let mut x_values = Vec::new();
    let mut y_values = Vec::new();
    let mut scale_values = Vec::new();
    for (id, time, center_x, center_y, keyframe_scale) in keyframes {
        let value_scale = cover_scale * keyframe_scale;
        let width = source_width * contain * value_scale;
        let height = source_height * contain * value_scale;
        x_values.push((
            id.clone(),
            time,
            ((0.5 - center_x) * width)
                .clamp((target_width - width) / 2.0, (width - target_width) / 2.0),
        ));
        y_values.push((
            id.clone(),
            time,
            ((0.5 - center_y) * height).clamp(
                (target_height - height) / 2.0,
                (height - target_height) / 2.0,
            ),
        ));
        scale_values.push((id, time, value_scale));
    }
    (
        params,
        Some(json!({
            "transform.positionX": channel("x", x_values),
            "transform.positionY": channel("y", y_values),
            "transform.scaleX": channel("scale_x", scale_values.clone()),
            "transform.scaleY": channel("scale_y", scale_values)
        })),
    )
}

fn automatic_hook_track(
    input: &ClipProjectConversionInputV1,
) -> Result<Option<CapinstaTextTrackV35>, Vec<ProjectConversionIssue>> {
    let Some(hook) = automatic_clipper(&input.clip_project)
        .and_then(|metadata| metadata.get("hookOverlay"))
        .and_then(Value::as_object)
    else {
        return Ok(None);
    };
    let text = hook
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let start_ms = hook.get("startMs").and_then(Value::as_i64).unwrap_or(0);
    let end_ms = hook.get("endMs").and_then(Value::as_i64).unwrap_or(0);
    if text.is_empty() || start_ms < 0 || end_ms <= start_ms {
        return Err(vec![issue(
            input,
            "invalid_automatic_hook",
            ProjectConversionSeverity::Error,
            "automatic clipper hook metadata is invalid",
            Some("clipProject.metadata.automaticClipper.hookOverlay"),
        )]);
    }
    let emojis = hook
        .get("supportingEmojis")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    let content = if emojis.is_empty() {
        text.to_owned()
    } else {
        format!("{text} {emojis}")
    };
    let safe_zone = automatic_clipper(&input.clip_project)
        .and_then(|metadata| metadata.get("safeZone"))
        .and_then(Value::as_object);
    let profile_hook_y = safe_zone
        .and_then(|profile| profile.get("hookCenterYPx"))
        .and_then(Value::as_i64)
        .unwrap_or(-560);
    let position_y = match hook.get("position").and_then(Value::as_str) {
        Some("bottom") => -profile_hook_y,
        Some("center") => 0,
        _ => profile_hook_y,
    };
    let mut params = text_params(&content);
    params["fontSize"] = json!(72);
    params["fontFamily"] = json!("Poppins, Noto Color Emoji");
    params["fontWeight"] = json!("bold");
    params["lineHeight"] = json!(1.05);
    params["background.enabled"] = json!(true);
    params["background.color"] = json!("#000000cc");
    params["background.cornerRadius"] = json!(18);
    params["background.paddingX"] = json!(32);
    params["background.paddingY"] = json!(20);
    params["transform.positionY"] = json!(position_y);
    Ok(Some(CapinstaTextTrackV35 {
        id: format!("{}__automatic_hook", input.target_project_id),
        name: "Automatic hook".into(),
        track_type: "text".into(),
        elements: vec![CapinstaTextElementV35 {
            id: format!("{}__automatic_hook__element", input.target_project_id),
            name: "Hook".into(),
            element_type: "text".into(),
            duration: checked_ticks(input, end_ms - start_ms, "hookOverlay.endMs")?,
            start_time: checked_ticks(input, start_ms, "hookOverlay.startMs")?,
            trim_start: 0,
            trim_end: 0,
            animations: Some(json!({
                "opacity": {"keys": [
                    {"id":"hook_opacity_1","time":0,"value":0.0,"segmentToNext":"linear","tangentMode":"auto"},
                    {"id":"hook_opacity_2","time":120 * TICKS_PER_MILLISECOND,"value":1.0,"segmentToNext":"linear","tangentMode":"auto"}
                ]},
                "transform.scaleX": {"keys": [
                    {"id":"hook_scale_x_1","time":0,"value":0.92,"segmentToNext":"linear","tangentMode":"auto"},
                    {"id":"hook_scale_x_2","time":120 * TICKS_PER_MILLISECOND,"value":1.0,"segmentToNext":"linear","tangentMode":"auto"}
                ]},
                "transform.scaleY": {"keys": [
                    {"id":"hook_scale_y_1","time":0,"value":0.92,"segmentToNext":"linear","tangentMode":"auto"},
                    {"id":"hook_scale_y_2","time":120 * TICKS_PER_MILLISECOND,"value":1.0,"segmentToNext":"linear","tangentMode":"auto"}
                ]}
            })),
            params,
            capinsta_document_id: String::new(),
            capinsta_clip_id: String::new(),
        }],
        hidden: false,
    }))
}

fn automatic_layout_tracks(
    input: &ClipProjectConversionInputV1,
) -> Result<Vec<CapinstaOverlayTrackV35>, Vec<ProjectConversionIssue>> {
    let Some(plan) = automatic_reframe(&input.clip_project) else {
        return Ok(vec![]);
    };
    if input.edit_decision_list.entries.is_empty() {
        return Ok(vec![]);
    }
    let source_width = plan
        .get("sourceWidth")
        .and_then(Value::as_f64)
        .unwrap_or(input.clip_project.canvas.width as f64);
    let source_height = plan
        .get("sourceHeight")
        .and_then(Value::as_f64)
        .unwrap_or(input.clip_project.canvas.height as f64);
    let target_width = input.clip_project.canvas.width as f64;
    let target_height = input.clip_project.canvas.height as f64;
    let contain = (target_width / source_width).min(target_height / source_height);
    let full_duration = checked_ticks(
        input,
        input.clip_project.source_media.duration_ms,
        "clipProject.sourceMedia.durationMs",
    )?;
    let mut tracks = Vec::new();
    for (entry_index, entry) in input.edit_decision_list.entries.iter().enumerate() {
        for (shot_index, shot) in plan
            .get("shots")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let strategy = shot.get("strategy").and_then(Value::as_str).unwrap_or("");
            if !matches!(strategy, "dual_subject_split" | "speaker_screen_stack") {
                continue;
            }
            let shot_start = shot
                .get("sourceStartMs")
                .and_then(Value::as_i64)
                .unwrap_or(entry.source_start_ms)
                .max(entry.source_start_ms);
            let shot_end = shot
                .get("sourceEndMs")
                .and_then(Value::as_i64)
                .unwrap_or(entry.source_end_ms)
                .min(entry.source_end_ms);
            if shot_end <= shot_start {
                continue;
            }
            for (region_index, region) in shot
                .get("layoutRegions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let role = region
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("region");
                let source_x = region
                    .get("sourceCenterX")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let source_y = region
                    .get("sourceCenterY")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let output_x = region
                    .get("outputCenterX")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let output_y = region
                    .get("outputCenterY")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let output_width = region
                    .get("outputWidth")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0);
                let output_height = region
                    .get("outputHeight")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let scale = ((target_width * output_width) / (source_width * contain))
                    .min((target_height * output_height) / (source_height * contain))
                    .max(0.1);
                let scaled_width = source_width * contain * scale;
                let scaled_height = source_height * contain * scale;
                let mut params = video_params();
                params["transform.scaleX"] = json!(scale);
                params["transform.scaleY"] = json!(scale);
                params["transform.positionX"] =
                    json!((output_x - 0.5) * target_width + (0.5 - source_x) * scaled_width);
                params["transform.positionY"] =
                    json!((output_y - 0.5) * target_height + (0.5 - source_y) * scaled_height);
                let track_id = format!(
                    "{}__layout__{:03}__{:03}__{:03}",
                    input.target_project_id,
                    entry_index + 1,
                    shot_index + 1,
                    region_index + 1
                );
                tracks.push(CapinstaOverlayTrackV35::Video(CapinstaVideoTrackV35 {
                    id: track_id.clone(),
                    name: format!("Automatic layout {role}"),
                    track_type: "video".into(),
                    elements: vec![CapinstaVideoElementV35 {
                        id: format!("{track_id}__element"),
                        name: role.replace('_', " "),
                        element_type: "video".into(),
                        media_id: entry.source_media_id.clone(),
                        duration: checked_ticks(input, shot_end - shot_start, "reframePlan.shots")?,
                        start_time: checked_ticks(
                            input,
                            ((shot_start - entry.source_start_ms) as f64 / entry.playback_rate)
                                .round() as i64,
                            "reframePlan.shots",
                        )?,
                        trim_start: checked_ticks(input, shot_start, "reframePlan.shots")?,
                        trim_end: checked_ticks(
                            input,
                            input.clip_project.source_media.duration_ms - shot_end,
                            "reframePlan.shots",
                        )?,
                        source_duration: full_duration,
                        is_source_audio_enabled: false,
                        hidden: false,
                        retime: retime(entry.playback_rate),
                        animations: None,
                        masks: None,
                        params,
                        source_asset_id: entry.source_media_id.clone(),
                        clipping_range_id: entry.range_id.clone(),
                        clipping_edl_entry_id: entry.id.clone(),
                    }],
                    muted: true,
                    hidden: false,
                }));
            }
        }
    }
    Ok(tracks)
}

fn retime(rate: f64) -> Option<CapinstaRetimeV35> {
    (rate != 1.0).then_some(CapinstaRetimeV35 {
        rate,
        maintain_pitch: None,
    })
}

fn map_video_entries(
    input: &ClipProjectConversionInputV1,
    track_id: &str,
) -> Result<(Vec<CapinstaVideoElementV35>, Vec<RangeMappingV1>), Vec<ProjectConversionIssue>> {
    let full_duration = checked_ticks(
        input,
        input.clip_project.source_media.duration_ms,
        "clipProject.sourceMedia.durationMs",
    )?;
    let mut elements = Vec::new();
    let mut mappings = Vec::new();
    for entry in &input.edit_decision_list.entries {
        let element_id = format!(
            "{}__range__{}__video",
            input.target_project_id, entry.range_id
        );
        let (params, animations) = reframe_params_and_animations(input, entry);
        elements.push(CapinstaVideoElementV35 {
            id: element_id.clone(),
            name: input
                .clip_project
                .ranges
                .iter()
                .find(|range| range.id == entry.range_id)
                .and_then(|range| range.label.clone())
                .unwrap_or_else(|| format!("Clip {}", entry.order + 1)),
            element_type: "video".into(),
            media_id: entry.source_media_id.clone(),
            duration: checked_ticks(input, entry.output_duration_ms, "entries.outputDurationMs")?,
            start_time: checked_ticks(input, entry.output_start_ms, "entries.outputStartMs")?,
            trim_start: checked_ticks(input, entry.source_start_ms, "entries.sourceStartMs")?,
            trim_end: checked_ticks(
                input,
                input.clip_project.source_media.duration_ms - entry.source_end_ms,
                "entries.sourceEndMs",
            )?,
            source_duration: full_duration,
            is_source_audio_enabled: true,
            hidden: false,
            retime: retime(entry.playback_rate),
            animations,
            masks: None,
            params,
            source_asset_id: entry.source_media_id.clone(),
            clipping_range_id: entry.range_id.clone(),
            clipping_edl_entry_id: entry.id.clone(),
        });
        mappings.push(range_mapping(entry, element_id, track_id.to_owned()));
    }
    Ok((elements, mappings))
}

fn map_audio_entries(
    input: &ClipProjectConversionInputV1,
    track_id: &str,
) -> Result<(Vec<CapinstaAudioElementV35>, Vec<RangeMappingV1>), Vec<ProjectConversionIssue>> {
    let full_duration = checked_ticks(
        input,
        input.clip_project.source_media.duration_ms,
        "clipProject.sourceMedia.durationMs",
    )?;
    let mut elements = Vec::new();
    let mut mappings = Vec::new();
    for entry in &input.edit_decision_list.entries {
        let element_id = format!(
            "{}__range__{}__audio",
            input.target_project_id, entry.range_id
        );
        elements.push(CapinstaAudioElementV35 {
            id: element_id.clone(),
            name: format!("Clip {}", entry.order + 1),
            element_type: "audio".into(),
            source_type: "upload".into(),
            media_id: entry.source_media_id.clone(),
            duration: checked_ticks(input, entry.output_duration_ms, "entries.outputDurationMs")?,
            start_time: checked_ticks(input, entry.output_start_ms, "entries.outputStartMs")?,
            trim_start: checked_ticks(input, entry.source_start_ms, "entries.sourceStartMs")?,
            trim_end: checked_ticks(
                input,
                input.clip_project.source_media.duration_ms - entry.source_end_ms,
                "entries.sourceEndMs",
            )?,
            source_duration: full_duration,
            retime: retime(entry.playback_rate),
            params: video_params(),
            source_asset_id: entry.source_media_id.clone(),
            clipping_range_id: entry.range_id.clone(),
            clipping_edl_entry_id: entry.id.clone(),
        });
        mappings.push(range_mapping(entry, element_id, track_id.to_owned()));
    }
    Ok((elements, mappings))
}

fn range_mapping(entry: &EdlEntryV1, element_id: String, track_id: String) -> RangeMappingV1 {
    RangeMappingV1 {
        range_id: entry.range_id.clone(),
        edl_entry_id: entry.id.clone(),
        timeline_element_ids: vec![element_id],
        track_ids: vec![track_id],
        source_media_id: entry.source_media_id.clone(),
        source_start_ms: entry.source_start_ms,
        source_end_ms: entry.source_end_ms,
        source_duration_ms: entry.source_duration_ms,
        timeline_start_ms: entry.output_start_ms,
        timeline_end_ms: entry.output_end_ms,
        output_duration_ms: entry.output_duration_ms,
        playback_rate: entry.playback_rate,
        order: entry.order,
    }
}

fn capinsta_timing_source(source: &TimingSource) -> &'static str {
    match source {
        TimingSource::Provider => "provider",
        TimingSource::Aligned => "forced_alignment",
        TimingSource::Interpolated => "repaired_provider",
        TimingSource::Estimated | TimingSource::Unknown => "estimated",
        TimingSource::ManuallyAdjusted => "manual",
    }
}

fn language_hint(language: Option<&str>) -> Option<String> {
    match language.map(|value| value.to_ascii_lowercase()) {
        Some(value) if value == "en" || value.starts_with("en-") => Some("english".into()),
        Some(value) if value == "hi" || value.starts_with("hi-") => Some("hindi".into()),
        Some(value) if value == "te" || value.starts_with("te-") => Some("telugu".into()),
        Some(_) => Some("unknown".into()),
        None => None,
    }
}

fn language_mode(transcript: &RemappedTranscriptV1) -> String {
    let languages: HashSet<_> = transcript
        .words
        .iter()
        .filter_map(|word| language_hint(word.language.as_deref()))
        .collect();
    if languages.len() > 1 {
        "auto_mixed_indian".into()
    } else {
        languages
            .into_iter()
            .next()
            .unwrap_or_else(|| "auto".into())
    }
}

fn canonical_word(word: &RemappedWordOccurrenceV1, id: &str) -> Value {
    json!({
        "id": id,
        "spokenText": word.original_text.as_deref().unwrap_or(&word.text),
        "displayText": word.text,
        "startUs": word.output_start_ms.unwrap_or_default() * 1000,
        "endUs": word.output_end_ms.unwrap_or_default() * 1000,
        "confidence": word.confidence,
        "timingSource": capinsta_timing_source(&word.timing_source),
        "timingNeedsReview": word.is_low_confidence || matches!(word.timing_source, TimingSource::Unknown),
        "speakerId": word.speaker_id,
        "language": word.language
    })
}

type CaptionBuild = (
    CapinstaTextTrackV35,
    CapinstaCaptionDocumentRecordV35,
    Vec<CaptionMappingV1>,
    Vec<ProjectConversionIssue>,
);

fn map_captions(
    input: &ClipProjectConversionInputV1,
    transcript: &RemappedTranscriptV1,
) -> Result<CaptionBuild, Vec<ProjectConversionIssue>> {
    let track_id = format!("{}__captions", input.target_project_id);
    let document_id = format!("{}__caption_document", input.target_project_id);
    let style_preset_id = input
        .clip_project
        .caption_track
        .as_ref()
        .and_then(|track| track.style_preset_id.clone())
        .unwrap_or_else(|| "word_highlight_box".into());
    let words_by_id: HashMap<_, _> = transcript
        .words
        .iter()
        .map(|word| (word.occurrence_id.as_str(), word))
        .collect();
    let mut caption_words = Vec::new();
    let mut canonical_words = Vec::new();
    let mut word_id_map = HashMap::new();
    let mut warnings = Vec::new();

    for word in &transcript.words {
        let (Some(start), Some(end)) = (word.output_start_ms, word.output_end_ms) else {
            let mut value = warning(
                input,
                "untimed_caption_word_omitted",
                "untimed caption word cannot be represented by the current Capinsta caption model",
                Some("remappedTranscript.words"),
            );
            value.caption_occurrence_id = Some(word.occurrence_id.clone());
            warnings.push(value);
            continue;
        };
        let id = format!(
            "{}__caption_word__{}",
            input.target_project_id, word.occurrence_id
        );
        word_id_map.insert(word.occurrence_id.as_str(), id.clone());
        caption_words.push(CapinstaCaptionWordV35 {
            id: id.clone(),
            text: word
                .original_text
                .clone()
                .unwrap_or_else(|| word.text.clone()),
            displayed_text: word.text.clone(),
            start: start as f64 / 1000.0,
            end: end as f64 / 1000.0,
            timing_source: capinsta_timing_source(&word.timing_source).into(),
            original_text: word.original_text.clone(),
            confidence: word.confidence,
            language_hint: language_hint(word.language.as_deref()),
            timing_source_detail: format!(
                "TranscriptDocumentV2:{}",
                timing_source_name(&word.timing_source)
            ),
            timing_needs_review: word.is_low_confidence
                || matches!(word.timing_source, TimingSource::Unknown),
            source_word_id: word.occurrence_id.clone(),
        });
        canonical_words.push(canonical_word(word, &id));
        if word.is_filler {
            let mut value = warning(
                input,
                "caption_metadata_not_supported",
                "the current caption model has no persisted filler flag",
                Some("remappedTranscript.words.isFiller"),
            );
            value.caption_occurrence_id = Some(word.occurrence_id.clone());
            warnings.push(value);
        }
    }

    let mut clips = Vec::new();
    let mut elements = Vec::new();
    let mut pages = Vec::new();
    let mut mappings = Vec::new();
    for (index, segment) in transcript.segments.iter().enumerate() {
        let (Some(start), Some(end)) = (segment.output_start_ms, segment.output_end_ms) else {
            let mut value = warning(
                input,
                "unsupported_caption_field",
                "untimed caption segment was omitted",
                Some("remappedTranscript.segments"),
            );
            value.caption_occurrence_id = Some(segment.occurrence_id.clone());
            warnings.push(value);
            continue;
        };
        let source_words: Vec<_> = segment
            .word_occurrence_ids
            .iter()
            .filter_map(|id| words_by_id.get(id.as_str()).copied())
            .collect();
        let caption_word_ids: Vec<_> = segment
            .word_occurrence_ids
            .iter()
            .filter_map(|id| word_id_map.get(id.as_str()).cloned())
            .collect();
        if source_words.len() != segment.word_occurrence_ids.len() {
            return Err(vec![issue(
                input,
                "caption_mapping_mismatch",
                ProjectConversionSeverity::Error,
                "caption segment has unresolved words",
                Some("remappedTranscript.segments.wordOccurrenceIds"),
            )]);
        }
        let clip_id = format!(
            "{}__caption_segment__{}",
            input.target_project_id, segment.occurrence_id
        );
        let element_id = format!("{clip_id}__element");
        let clip_source = capinsta_timing_source(&segment.timing_source).to_owned();
        clips.push(CapinstaCaptionClipV35 {
            id: clip_id.clone(),
            track_id: track_id.clone(),
            start: start as f64 / 1000.0,
            end: end as f64 / 1000.0,
            text: segment.text.clone(),
            word_ids: caption_word_ids.clone(),
            style_preset_id: style_preset_id.clone(),
            selected: false,
            editable: true,
            manually_edited: matches!(segment.timing_source, TimingSource::ManuallyAdjusted),
            timing_needs_review: source_words.iter().any(|word| word.is_low_confidence),
            timing_source: clip_source,
            source_clip_id: segment.occurrence_id.clone(),
            style_overrides: automatic_clipper(&input.clip_project)
                .and_then(|metadata| metadata.get("captionComposition"))
                .and_then(Value::as_object)
                .map(|caption| {
                    json!({
                        "text": {
                            "wordSpacing": caption.get("wordSpacing")
                                .and_then(Value::as_f64).unwrap_or(8.0),
                            "maxLines": caption.get("maximumLines")
                                .and_then(Value::as_i64).unwrap_or(2)
                        },
                        "layout": {
                            "positionY": caption.get("positionY")
                                .and_then(Value::as_f64).unwrap_or(500.0),
                            "maxWidth": caption.get("maximumWidth")
                                .and_then(Value::as_f64).unwrap_or(82.0),
                            "safeAreaEnabled": true
                        }
                    })
                }),
            manual_edit: segment.original_text.as_ref().map(|original| {
                json!({
                    "originalText": original,
                    "originalStart": segment.original_source_start_ms.map(|value| value as f64 / 1000.0),
                    "originalEnd": segment.original_source_end_ms.map(|value| value as f64 / 1000.0)
                })
            }),
        });
        elements.push(CapinstaTextElementV35 {
            id: element_id.clone(),
            name: format!("Caption {}", index + 1),
            element_type: "text".into(),
            duration: checked_ticks(input, end - start, "remappedTranscript.segments")?,
            start_time: checked_ticks(input, start, "remappedTranscript.segments")?,
            trim_start: 0,
            trim_end: 0,
            animations: None,
            params: text_params(&segment.text),
            capinsta_document_id: document_id.clone(),
            capinsta_clip_id: clip_id.clone(),
        });
        pages.push(json!({
            "id": clip_id,
            "wordIds": caption_word_ids,
            "startUs": start * 1000,
            "endUs": end * 1000,
            "displayTextOverride": segment.text,
            "activeWordEffectsEnabled": !source_words.iter().any(|word| word.is_low_confidence)
        }));
        mappings.push(CaptionMappingV1 {
            segment_occurrence_id: segment.occurrence_id.clone(),
            caption_element_id: element_id,
            source_word_occurrence_ids: segment.word_occurrence_ids.clone(),
            caption_word_ids: caption_word_ids.clone(),
        });
    }
    let document = CapinstaCaptionDocumentV35 {
        id: document_id,
        track_id: track_id.clone(),
        source_transcript_ref: json!({
            "version": "capinsta.transcript.v1",
            "sourceAssetId": input.clip_project.source_media.media_id,
            "sourceAssetName": input.clip_project.source_media.display_name.as_deref().unwrap_or("Source media"),
            "provider": "canonical-v2"
        }),
        duration_seconds: transcript.output_duration_ms as f64 / 1000.0,
        language_mode: language_mode(transcript),
        style_preset_id,
        clips,
        words: caption_words,
        manual_edits: json!({}),
        timing: json!({
            "sourceOfTruth": "words",
            "generatedAt": input.clip_project.updated_at,
            "audioDurationSeconds": transcript.output_duration_ms as f64 / 1000.0,
            "timelineOffsetSeconds": 0,
            "timelineOffsetUs": 0,
            "audioOrigin": "rendered_timeline"
        }),
        canonical_timing: json!({
            "version": "capinsta.caption.v2",
            "mediaDurationUs": transcript.output_duration_ms * 1000,
            "timelineOffsetUs": 0,
            "words": canonical_words,
            "pages": pages,
            "vadRegions": [],
            "diagnostics": {
                "decodedDurationUs": transcript.output_duration_ms * 1000,
                "normalizedSampleCount": 0,
                "providerDurationUs": transcript.output_duration_ms * 1000,
                "timelineOffsetUs": 0,
                "providerWordCount": transcript.words.len(),
                "repairedWordCount": 0,
                "forcedAlignedWordCount": 0,
                "estimatedWordCount": 0,
                "vadSpeechDurationUs": 0,
                "vadSilenceDurationUs": 0,
                "maximumTimingDriftUs": 0,
                "validationFailures": [],
                "counters": {}
            }
        }),
    };
    Ok((
        CapinstaTextTrackV35 {
            id: track_id.clone(),
            name: "Captions".into(),
            track_type: "text".into(),
            elements,
            hidden: false,
        },
        CapinstaCaptionDocumentRecordV35 {
            document,
            open_cut_track_id: track_id,
            imported_at: input.clip_project.updated_at.clone(),
        },
        mappings,
        warnings,
    ))
}

fn timing_source_name(source: &TimingSource) -> &'static str {
    match source {
        TimingSource::Provider => "provider",
        TimingSource::Aligned => "aligned",
        TimingSource::Interpolated => "interpolated",
        TimingSource::Estimated => "estimated",
        TimingSource::ManuallyAdjusted => "manuallyAdjusted",
        TimingSource::Unknown => "unknown",
    }
}

fn validate_generated_project(
    input: &ClipProjectConversionInputV1,
    project: &CapinstaProjectV35,
    mapping: &ProjectConversionMappingV1,
) -> Vec<ProjectConversionIssue> {
    let mut issues = Vec::new();
    let scene = &project.scenes[0];
    let mut generated_ids = HashSet::new();
    for id in [
        project.metadata.id.as_str(),
        scene.id.as_str(),
        scene.tracks.main.id.as_str(),
    ] {
        if !generated_ids.insert(id) {
            issues.push(issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "generated project identifiers collide",
                None,
            ));
        }
    }
    for element in &scene.tracks.main.elements {
        if !generated_ids.insert(element.id.as_str()) {
            issues.push(issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "generated timeline element identifiers collide",
                None,
            ));
        }
    }
    for track in &scene.tracks.audio {
        if !generated_ids.insert(track.id.as_str()) {
            issues.push(issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "generated track identifiers collide",
                None,
            ));
        }
        for element in &track.elements {
            if !generated_ids.insert(element.id.as_str()) {
                issues.push(issue(
                    input,
                    "duplicate_generated_id",
                    ProjectConversionSeverity::Error,
                    "generated timeline element identifiers collide",
                    None,
                ));
            }
        }
    }
    for track in &scene.tracks.overlay {
        let (track_id, elements): (&str, Vec<&str>) = match track {
            CapinstaOverlayTrackV35::Text(track) => (
                track.id.as_str(),
                track.elements.iter().map(|item| item.id.as_str()).collect(),
            ),
            CapinstaOverlayTrackV35::Video(track) => (
                track.id.as_str(),
                track.elements.iter().map(|item| item.id.as_str()).collect(),
            ),
        };
        if !generated_ids.insert(track_id) {
            issues.push(issue(
                input,
                "duplicate_generated_id",
                ProjectConversionSeverity::Error,
                "generated track identifiers collide",
                None,
            ));
        }
        for element_id in elements {
            if !generated_ids.insert(element_id) {
                issues.push(issue(
                    input,
                    "duplicate_generated_id",
                    ProjectConversionSeverity::Error,
                    "generated caption element identifiers collide",
                    None,
                ));
            }
        }
    }
    if mapping.range_mappings.len() != input.edit_decision_list.entries.len() {
        issues.push(issue(
            input,
            "timeline_mapping_mismatch",
            ProjectConversionSeverity::Error,
            "not every enabled EDL entry has a range mapping",
            Some("mapping.rangeMappings"),
        ));
    }
    let contiguous = mapping
        .range_mappings
        .iter()
        .enumerate()
        .all(|(index, item)| {
            item.timeline_start_ms
                == if index == 0 {
                    0
                } else {
                    mapping.range_mappings[index - 1].timeline_end_ms
                }
        });
    let final_end = mapping
        .range_mappings
        .last()
        .map_or(0, |item| item.timeline_end_ms);
    if !contiguous || final_end != input.edit_decision_list.output_duration_ms {
        issues.push(issue(
            input,
            "invalid_timeline_duration",
            ProjectConversionSeverity::Error,
            "generated timeline is not contiguous or has the wrong endpoint",
            Some("project.scenes.tracks"),
        ));
    }
    issues
}

/// Convert a validated clipping project into a deterministic, loader-compatible
/// Capinsta version-35 project. The input is borrowed and never mutated.
pub fn convert_clip_project_to_capinsta(
    input: &ClipProjectConversionInputV1,
) -> Result<CapinstaProjectConversionResultV1, Vec<ProjectConversionIssue>> {
    let problems = validate_input(input);
    if !problems.is_empty() {
        return Err(problems);
    }
    let mut warnings = Vec::new();
    for range in input
        .clip_project
        .ranges
        .iter()
        .filter(|range| !range.enabled)
    {
        let mut value = warning(
            input,
            "disabled_range_omitted",
            "disabled range was not included in the Capinsta timeline",
            Some("clipProject.ranges.enabled"),
        );
        value.range_id = Some(range.id.clone());
        warnings.push(value);
    }
    if input.clip_project.canvas.safe_area.is_some() {
        warnings.push(warning(
            input,
            "canvas_safe_area_not_supported",
            "Capinsta project settings have no persisted safe-area field",
            Some("clipProject.canvas.safeArea"),
        ));
    }
    if input.clip_project.canvas.background.is_none() {
        warnings.push(warning(
            input,
            "project_field_defaulted",
            "canvas background defaulted to #000000",
            Some("clipProject.canvas.background"),
        ));
    }
    warnings.push(warning(
        input,
        "project_field_defaulted",
        "project frame rate defaulted to 30 fps because ClipProjectV1 has no frame-rate field",
        Some("project.settings.fps"),
    ));
    let has_unused_metadata = input
        .clip_project
        .metadata
        .as_object()
        .is_some_and(|metadata| metadata.keys().any(|key| key != "automaticClipper"));
    if has_unused_metadata {
        warnings.push(warning(
            input,
            "unused_clip_project_metadata",
            "clip project metadata is retained by the source contract but does not affect rendering",
            Some("clipProject.metadata"),
        ));
    }

    let video_track_id = format!("{}__video", input.target_project_id);
    let audio_track_id = format!("{}__audio", input.target_project_id);
    let mime = input.clip_project.source_media.mime_type.as_deref();
    let audio_only = mime.is_some_and(|value| value.starts_with("audio/"));
    if mime.is_none() {
        warnings.push(warning(
            input,
            "project_field_defaulted",
            "source MIME type is absent; conversion selected a combined video/source-audio element",
            Some("clipProject.sourceMedia.mimeType"),
        ));
    }
    let (video_elements, audio_tracks, range_mappings) = if audio_only {
        let (audio_elements, mappings) = map_audio_entries(input, &audio_track_id)?;
        (
            Vec::new(),
            vec![CapinstaAudioTrackV35 {
                id: audio_track_id,
                name: "Source audio".into(),
                track_type: "audio".into(),
                elements: audio_elements,
                muted: false,
            }],
            mappings,
        )
    } else {
        let (elements, mappings) = map_video_entries(input, &video_track_id)?;
        (elements, Vec::new(), mappings)
    };

    let mut overlay = automatic_layout_tracks(input)?;
    if let Some(hook_track) = automatic_hook_track(input)? {
        overlay.push(CapinstaOverlayTrackV35::Text(hook_track));
    }
    let mut caption_documents = None;
    let mut caption_mappings = Vec::new();
    if input.options.include_captions {
        if let Some(transcript) = &input.remapped_transcript {
            if input
                .clip_project
                .caption_track
                .as_ref()
                .is_none_or(|track| track.enabled)
            {
                let (track, document, mappings, caption_warnings) =
                    map_captions(input, transcript)?;
                overlay.push(CapinstaOverlayTrackV35::Text(track));
                caption_documents = Some(vec![document]);
                caption_mappings = mappings;
                warnings.extend(caption_warnings);
            }
        }
    }
    warnings.sort_by(|a, b| {
        (
            a.category.as_str(),
            a.field_path.as_deref().unwrap_or(""),
            a.range_id.as_deref().unwrap_or(""),
            a.caption_occurrence_id.as_deref().unwrap_or(""),
        )
            .cmp(&(
                b.category.as_str(),
                b.field_path.as_deref().unwrap_or(""),
                b.range_id.as_deref().unwrap_or(""),
                b.caption_occurrence_id.as_deref().unwrap_or(""),
            ))
    });
    if input.options.unsupported_feature_policy == UnsupportedFeaturePolicy::Error {
        let errors: Vec<_> = warnings
            .iter()
            .filter(|warning| {
                matches!(
                    warning.category.as_str(),
                    "canvas_safe_area_not_supported"
                        | "caption_metadata_not_supported"
                        | "unsupported_caption_field"
                        | "untimed_caption_word_omitted"
                )
            })
            .cloned()
            .map(|mut problem| {
                problem.severity = ProjectConversionSeverity::Error;
                problem
            })
            .collect();
        if !errors.is_empty() {
            return Err(errors);
        }
    }

    let output_ticks = checked_ticks(
        input,
        input.edit_decision_list.output_duration_ms,
        "editDecisionList.outputDurationMs",
    )?;
    let scene_id = format!("{}__main_scene", input.target_project_id);
    let project = CapinstaProjectV35 {
        metadata: CapinstaProjectMetadataV35 {
            id: input.target_project_id.clone(),
            name: input.clip_project.name.clone(),
            duration: output_ticks,
            created_at: input.clip_project.created_at.clone(),
            updated_at: input.clip_project.updated_at.clone(),
        },
        scenes: vec![CapinstaSceneV35 {
            id: scene_id.clone(),
            name: "Main scene".into(),
            is_main: true,
            tracks: CapinstaSceneTracksV35 {
                overlay,
                main: CapinstaVideoTrackV35 {
                    id: video_track_id,
                    name: "Main".into(),
                    track_type: "video".into(),
                    elements: video_elements,
                    muted: false,
                    hidden: false,
                },
                audio: audio_tracks,
            },
            bookmarks: Vec::new(),
            created_at: input.clip_project.created_at.clone(),
            updated_at: input.clip_project.updated_at.clone(),
        }],
        current_scene_id: scene_id,
        settings: CapinstaProjectSettingsV35 {
            fps: CapinstaFrameRateV35 {
                numerator: 30,
                denominator: 1,
            },
            canvas_size: CapinstaCanvasSizeV35 {
                width: input.clip_project.canvas.width,
                height: input.clip_project.canvas.height,
            },
            canvas_size_mode: if input.clip_project.canvas.aspect_ratio == "custom" {
                "custom"
            } else {
                "preset"
            }
            .into(),
            last_custom_canvas_size: (input.clip_project.canvas.aspect_ratio == "custom").then(
                || CapinstaCanvasSizeV35 {
                    width: input.clip_project.canvas.width,
                    height: input.clip_project.canvas.height,
                },
            ),
            original_canvas_size: None,
            background: CapinstaBackgroundV35 {
                background_type: if uses_blurred_background(&input.clip_project) {
                    "blur"
                } else {
                    "color"
                }
                .into(),
                color: (!uses_blurred_background(&input.clip_project)).then(|| {
                    input
                        .clip_project
                        .canvas
                        .background
                        .clone()
                        .unwrap_or_else(|| "#000000".into())
                }),
                blur_intensity: uses_blurred_background(&input.clip_project).then_some(30.0),
            },
        },
        version: CAPINSTA_PROJECT_VERSION,
        timeline_view_state: CapinstaTimelineViewStateV35 {
            zoom_level: 1.0,
            scroll_left: 0.0,
            playhead_time: 0,
        },
        capinsta_caption_documents: caption_documents,
        capinsta_clipping_provenance: CapinstaClippingProvenanceV1 {
            source_application: "clipper".into(),
            source_clip_project_id: input.clip_project.clip_project_id.clone(),
            source_clip_project_revision: input.clip_project.revision,
            source_transcript_id: input.clip_project.transcript_id.clone(),
            conversion_schema_version: CONVERSION_SCHEMA_VERSION,
        },
    };
    let mapping = ProjectConversionMappingV1 {
        source_media_id: input.clip_project.source_media.media_id.clone(),
        capinsta_media_id: input.clip_project.source_media.media_id.clone(),
        range_mappings,
        caption_mappings,
    };
    let generated_problems = validate_generated_project(input, &project, &mapping);
    if !generated_problems.is_empty() {
        return Err(generated_problems);
    }
    Ok(CapinstaProjectConversionResultV1 {
        schema_version: CONVERSION_SCHEMA_VERSION,
        source_clip_project_id: input.clip_project.clip_project_id.clone(),
        source_clip_project_revision: input.clip_project.revision,
        target_project_id: input.target_project_id.clone(),
        project,
        media_reference: CapinstaMediaReferenceV1 {
            media_id: input.clip_project.source_media.media_id.clone(),
            source_asset_id: input.clip_project.source_media.media_id.clone(),
            display_name: input
                .clip_project
                .source_media
                .display_name
                .clone()
                .unwrap_or_else(|| "Source media".into()),
            mime_type: input.clip_project.source_media.mime_type.clone(),
            duration_ms: input.clip_project.source_media.duration_ms,
            requires_media_attachment: true,
        },
        mapping,
        warnings,
        metadata: input.metadata.clone(),
    })
}

#[cfg(test)]
mod tests;

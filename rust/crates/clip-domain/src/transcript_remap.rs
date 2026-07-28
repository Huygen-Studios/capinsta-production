use crate::{DomainWarning, EditDecisionListV1, ValidationIssue, source_to_output};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use transcript_domain::{TimingSource, TranscriptDocumentV2};
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WordBoundaryPolicy {
    Contained,
    Intersecting,
    Clipped,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UntimedWordPolicy {
    ExcludeWithWarning,
    PreserveUntimed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMappingOptions {
    pub boundary_policy: WordBoundaryPolicy,
    pub untimed_word_policy: UntimedWordPolicy,
}
impl Default for TranscriptMappingOptions {
    fn default() -> Self {
        Self {
            boundary_policy: WordBoundaryPolicy::Clipped,
            untimed_word_policy: UntimedWordPolicy::ExcludeWithWarning,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemappedWordOccurrenceV1 {
    pub occurrence_id: String,
    pub source_word_id: String,
    pub source_segment_id: String,
    pub range_id: String,
    pub text: String,
    pub original_text: Option<String>,
    pub original_source_start_ms: Option<i64>,
    pub original_source_end_ms: Option<i64>,
    pub effective_source_start_ms: Option<i64>,
    pub effective_source_end_ms: Option<i64>,
    pub output_start_ms: Option<i64>,
    pub output_end_ms: Option<i64>,
    pub speaker_id: Option<String>,
    pub language: Option<String>,
    pub confidence: Option<f64>,
    pub timing_source: TimingSource,
    pub is_filler: bool,
    pub is_low_confidence: bool,
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemappedSegmentOccurrenceV1 {
    pub occurrence_id: String,
    pub source_segment_id: String,
    pub range_id: String,
    pub text: String,
    pub original_text: Option<String>,
    pub original_source_start_ms: Option<i64>,
    pub original_source_end_ms: Option<i64>,
    pub effective_source_start_ms: Option<i64>,
    pub effective_source_end_ms: Option<i64>,
    pub output_start_ms: Option<i64>,
    pub output_end_ms: Option<i64>,
    pub word_occurrence_ids: Vec<String>,
    pub speaker_id: Option<String>,
    pub language: Option<String>,
    pub confidence: Option<f64>,
    pub timing_source: TimingSource,
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemappedTranscriptV1 {
    pub schema_version: u8,
    pub source_transcript_id: String,
    pub clip_project_id: String,
    pub project_revision: u64,
    pub source_media_id: String,
    pub output_duration_ms: i64,
    pub segments: Vec<RemappedSegmentOccurrenceV1>,
    pub words: Vec<RemappedWordOccurrenceV1>,
    pub warnings: Vec<DomainWarning>,
    pub metadata: Value,
}
fn issue(category: &str, path: &str, id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        category: category.into(),
        field_path: path.into(),
        entity_id: id,
        message: category.into(),
    }
}
pub fn map_transcript_to_output(
    transcript: &TranscriptDocumentV2,
    edl: &EditDecisionListV1,
    options: &TranscriptMappingOptions,
) -> Result<RemappedTranscriptV1, Vec<ValidationIssue>> {
    if transcript.media_id != edl.source_media_id {
        return Err(vec![issue(
            "transcript_mismatch",
            "mediaId",
            Some(transcript.transcript_id.clone()),
        )]);
    }
    if edl
        .entries
        .iter()
        .any(|e| e.source_end_ms > transcript.duration_ms)
    {
        return Err(vec![issue(
            "transcript_mismatch",
            "durationMs",
            Some(transcript.transcript_id.clone()),
        )]);
    }
    let mut warnings = Vec::new();
    let mut words = Vec::new();
    for word in &transcript.words {
        match (word.start_ms, word.end_ms) {
            (Some(ws), Some(we)) => {
                if we < ws {
                    return Err(vec![issue(
                        "invalid_word_timing",
                        "words",
                        Some(word.id.clone()),
                    )]);
                }
                for entry in &edl.entries {
                    let intersects = ws < entry.source_end_ms && we > entry.source_start_ms;
                    let contained = ws >= entry.source_start_ms && we <= entry.source_end_ms;
                    if !(match options.boundary_policy {
                        WordBoundaryPolicy::Contained => contained,
                        WordBoundaryPolicy::Intersecting | WordBoundaryPolicy::Clipped => {
                            intersects
                        }
                    }) {
                        continue;
                    }
                    let a = ws.max(entry.source_start_ms);
                    let b = we.min(entry.source_end_ms);
                    if b < a {
                        continue;
                    }
                    let index = words
                        .iter()
                        .filter(|x: &&RemappedWordOccurrenceV1| {
                            x.range_id == entry.range_id && x.source_word_id == word.id
                        })
                        .count();
                    let suffix = if index == 0 {
                        "".into()
                    } else {
                        format!("__{index}")
                    };
                    words.push(RemappedWordOccurrenceV1 {
                        occurrence_id: format!("{}__{}{}", entry.range_id, word.id, suffix),
                        source_word_id: word.id.clone(),
                        source_segment_id: word.segment_id.clone(),
                        range_id: entry.range_id.clone(),
                        text: word.text.clone(),
                        original_text: word.original_text.clone(),
                        original_source_start_ms: Some(ws),
                        original_source_end_ms: Some(we),
                        effective_source_start_ms: Some(a),
                        effective_source_end_ms: Some(b),
                        output_start_ms: Some(source_to_output(entry, a).map_err(|x| vec![x])?),
                        output_end_ms: Some(source_to_output(entry, b).map_err(|x| vec![x])?),
                        speaker_id: word.speaker_id.clone(),
                        language: word.language.clone(),
                        confidence: word.confidence,
                        timing_source: word.timing_source.clone(),
                        is_filler: word.is_filler,
                        is_low_confidence: word.is_low_confidence,
                        metadata: word.metadata.clone(),
                    })
                }
            }
            (None, None) => match options.untimed_word_policy {
                UntimedWordPolicy::ExcludeWithWarning => warnings.push(DomainWarning {
                    category: "untimed_word_excluded".into(),
                    message: format!("Untimed word {} excluded", word.id),
                    range_id: None,
                }),
                UntimedWordPolicy::PreserveUntimed => {
                    for entry in &edl.entries {
                        words.push(RemappedWordOccurrenceV1 {
                            occurrence_id: format!("{}__{}", entry.range_id, word.id),
                            source_word_id: word.id.clone(),
                            source_segment_id: word.segment_id.clone(),
                            range_id: entry.range_id.clone(),
                            text: word.text.clone(),
                            original_text: word.original_text.clone(),
                            original_source_start_ms: None,
                            original_source_end_ms: None,
                            effective_source_start_ms: None,
                            effective_source_end_ms: None,
                            output_start_ms: None,
                            output_end_ms: None,
                            speaker_id: word.speaker_id.clone(),
                            language: word.language.clone(),
                            confidence: word.confidence,
                            timing_source: word.timing_source.clone(),
                            is_filler: word.is_filler,
                            is_low_confidence: word.is_low_confidence,
                            metadata: word.metadata.clone(),
                        })
                    }
                }
            },
            _ => {
                return Err(vec![issue(
                    "invalid_word_timing",
                    "words",
                    Some(word.id.clone()),
                )]);
            }
        }
    }
    words.sort_by_key(|w| {
        (
            w.output_start_ms.unwrap_or(i64::MAX),
            w.occurrence_id.clone(),
        )
    });
    let mut segments = Vec::new();
    for segment in &transcript.segments {
        for entry in &edl.entries {
            let ws: Vec<_> = words
                .iter()
                .filter(|w| w.source_segment_id == segment.id && w.range_id == entry.range_id)
                .collect();
            if ws.is_empty() {
                continue;
            }
            let timed: Vec<_> = ws.iter().filter(|w| w.output_start_ms.is_some()).collect();
            segments.push(RemappedSegmentOccurrenceV1 {
                occurrence_id: format!("{}__{}", entry.range_id, segment.id),
                source_segment_id: segment.id.clone(),
                range_id: entry.range_id.clone(),
                text: segment.text.clone(),
                original_text: segment.original_text.clone(),
                original_source_start_ms: Some(segment.start_ms),
                original_source_end_ms: Some(segment.end_ms),
                effective_source_start_ms: timed.first().and_then(|w| w.effective_source_start_ms),
                effective_source_end_ms: timed.last().and_then(|w| w.effective_source_end_ms),
                output_start_ms: timed.first().and_then(|w| w.output_start_ms),
                output_end_ms: timed.last().and_then(|w| w.output_end_ms),
                word_occurrence_ids: ws.iter().map(|w| w.occurrence_id.clone()).collect(),
                speaker_id: segment.speaker_id.clone(),
                language: segment.language.clone(),
                confidence: segment.confidence,
                timing_source: segment.timing_source.clone(),
                metadata: segment.metadata.clone(),
            })
        }
    }
    segments.sort_by_key(|s| {
        (
            s.output_start_ms.unwrap_or(i64::MAX),
            s.occurrence_id.clone(),
        )
    });
    Ok(RemappedTranscriptV1 {
        schema_version: 1,
        source_transcript_id: transcript.transcript_id.clone(),
        clip_project_id: edl.clip_project_id.clone(),
        project_revision: edl.project_revision,
        source_media_id: edl.source_media_id.clone(),
        output_duration_ms: edl.output_duration_ms,
        segments,
        words,
        warnings,
        metadata: Value::Object(Default::default()),
    })
}

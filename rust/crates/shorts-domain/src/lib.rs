//! Deterministic automatic-short planning. All persisted time is integer milliseconds.

use clip_domain::{
    CaptionTrackReferenceV1, ClipBoundaryV1, ClipCanvasV1, ClipProjectSettingsV1, ClipProjectV1,
    ClipRangeV1, ClipSelectionReferenceV1,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cmp::Ordering;
use transcript_domain::{TranscriptDocumentV2, Word};

pub const CANDIDATE_SCHEMA_VERSION: u8 = 1;
pub const REFRAME_SCHEMA_VERSION: u8 = 1;
pub const SAFE_ZONE_SCHEMA_VERSION: u8 = 1;
const MIN_CANDIDATE_MS: i64 = 20_000;
const MAX_CANDIDATE_MS: i64 = 90_000;
const MAX_CANDIDATES: usize = 8;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeZoneProfileV1 {
    pub schema_version: u8,
    pub id: String,
    pub top_reserved_px: u16,
    pub bottom_reserved_px: u16,
    pub right_reserved_px: u16,
    pub hook_center_y_px: i16,
    pub caption_position_percent: u8,
    pub subject_top_px: u16,
    pub subject_bottom_px: u16,
}

pub fn safe_zone_profile(id: &str) -> SafeZoneProfileV1 {
    let (top, bottom, right, hook_y, caption_y, subject_top, subject_bottom) = match id {
        "tiktok-v1" => (190, 430, 150, -560, 73, 250, 1360),
        "reels-v1" => (180, 410, 130, -570, 75, 240, 1370),
        "youtube-shorts-v1" => (170, 390, 140, -580, 76, 230, 1380),
        _ => (180, 420, 140, -560, 74, 240, 1360),
    };
    SafeZoneProfileV1 {
        schema_version: SAFE_ZONE_SCHEMA_VERSION,
        id: match id {
            "tiktok-v1" | "reels-v1" | "youtube-shorts-v1" => id,
            _ => "shorts-generic-v1",
        }
        .into(),
        top_reserved_px: top,
        bottom_reserved_px: bottom,
        right_reserved_px: right,
        hook_center_y_px: hook_y,
        caption_position_percent: caption_y,
        subject_top_px: subject_top,
        subject_bottom_px: subject_bottom,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateScoreBreakdownV1 {
    pub hook_strength: u8,
    pub clarity: u8,
    pub payoff: u8,
    pub emotion: u8,
    pub novelty: u8,
}

impl CandidateScoreBreakdownV1 {
    fn normalized(&self) -> Self {
        Self {
            hook_strength: self.hook_strength.min(20),
            clarity: self.clarity.min(20),
            payoff: self.payoff.min(20),
            emotion: self.emotion.min(20),
            novelty: self.novelty.min(20),
        }
    }

    fn total(&self) -> u8 {
        self.hook_strength
            .saturating_add(self.clarity)
            .saturating_add(self.payoff)
            .saturating_add(self.emotion)
            .saturating_add(self.novelty)
            .min(100)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptEvidenceV1 {
    #[serde(default)]
    pub word_ids: Vec<String>,
    #[serde(default)]
    pub segment_ids: Vec<String>,
    #[serde(default)]
    pub excerpt: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViralCandidateProposalV1 {
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub hook_text: String,
    #[serde(default)]
    pub supporting_emojis: Vec<String>,
    #[serde(default)]
    pub score_breakdown: CandidateScoreBreakdownV1,
    #[serde(default)]
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateAnalysisInputV1 {
    pub transcript: TranscriptDocumentV2,
    #[serde(default)]
    pub proposals: Vec<ViralCandidateProposalV1>,
    #[serde(default)]
    pub silence_boundaries_ms: Vec<i64>,
    pub prompt_version: String,
    pub provider_name: String,
    pub provider_model: Option<String>,
    pub provider_request_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCandidateV1 {
    pub candidate_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub duration_ms: i64,
    pub title: String,
    pub hook_text: String,
    pub supporting_emojis: Vec<String>,
    pub viral_score: u8,
    pub score_breakdown: CandidateScoreBreakdownV1,
    pub reason: String,
    pub transcript_evidence: TranscriptEvidenceV1,
    pub recommended_framing_strategy: String,
    pub recommended_caption_preset: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralCandidateAnalysisDocumentV1 {
    pub schema_version: u8,
    pub transcript_id: String,
    pub media_id: String,
    pub duration_ms: i64,
    pub prompt_version: String,
    pub provider: Value,
    pub candidates: Vec<ViralCandidateV1>,
    pub warnings: Vec<String>,
}

fn truncate(value: &str, maximum_chars: usize) -> String {
    value.trim().chars().take(maximum_chars).collect()
}

fn timed_words(document: &TranscriptDocumentV2) -> Vec<&Word> {
    let mut words: Vec<_> = document
        .words
        .iter()
        .filter(|word| word.start_ms.is_some() && word.end_ms.is_some())
        .collect();
    words.sort_by_key(|word| {
        (
            word.start_ms.unwrap_or_default(),
            word.end_ms.unwrap_or_default(),
        )
    });
    words
}

fn nearest_boundary(target: i64, candidates: impl Iterator<Item = i64>) -> Option<i64> {
    candidates.min_by_key(|value| (value - target).abs())
}

fn snap_range(
    document: &TranscriptDocumentV2,
    start: i64,
    end: i64,
    silence_boundaries: &[i64],
) -> Option<(i64, i64)> {
    let words = timed_words(document);
    if words.is_empty() {
        let segment_start = nearest_boundary(
            start,
            document.segments.iter().map(|segment| segment.start_ms),
        )?;
        let segment_end =
            nearest_boundary(end, document.segments.iter().map(|segment| segment.end_ms))?;
        return (segment_end > segment_start)
            .then_some((segment_start.max(0), segment_end.min(document.duration_ms)));
    }
    let word_start = nearest_boundary(start, words.iter().filter_map(|word| word.start_ms))?;
    let word_end = nearest_boundary(end, words.iter().filter_map(|word| word.end_ms))?;
    let safe_silence = |boundary: i64| {
        !words.iter().any(|word| {
            word.start_ms.is_some_and(|start| start < boundary)
                && word.end_ms.is_some_and(|end| boundary < end)
        })
    };
    let snapped_start = nearest_boundary(
        word_start,
        silence_boundaries
            .iter()
            .copied()
            .filter(|value| (*value - word_start).abs() <= 400 && safe_silence(*value)),
    )
    .unwrap_or(word_start);
    let snapped_end = nearest_boundary(
        word_end,
        silence_boundaries
            .iter()
            .copied()
            .filter(|value| (*value - word_end).abs() <= 400 && safe_silence(*value)),
    )
    .unwrap_or(word_end);
    let start = snapped_start.max(0);
    let end = snapped_end.min(document.duration_ms);
    (end > start).then_some((start, end))
}

fn fallback_proposals(document: &TranscriptDocumentV2) -> Vec<ViralCandidateProposalV1> {
    let mut result = Vec::new();
    let mut cursor = 0;
    while cursor < document.segments.len() && result.len() < MAX_CANDIDATES {
        let first = &document.segments[cursor];
        let mut end_index = cursor;
        while end_index + 1 < document.segments.len()
            && document.segments[end_index].end_ms - first.start_ms < 45_000
        {
            end_index += 1;
        }
        let last = &document.segments[end_index];
        if last.end_ms - first.start_ms >= MIN_CANDIDATE_MS
            || document.duration_ms < MIN_CANDIDATE_MS
        {
            result.push(ViralCandidateProposalV1 {
                source_start_ms: first.start_ms,
                source_end_ms: last.end_ms,
                title: truncate(&first.text, 80),
                hook_text: truncate(&first.text, 120),
                supporting_emojis: vec![],
                score_breakdown: CandidateScoreBreakdownV1 {
                    hook_strength: 12,
                    clarity: 14,
                    payoff: 12,
                    emotion: 10,
                    novelty: 10,
                },
                reason: "Deterministic transcript fallback".into(),
            });
        }
        cursor = end_index.saturating_add(1);
    }
    result
}

fn overlap_ratio(left: &ViralCandidateV1, right: &ViralCandidateV1) -> f64 {
    let overlap = (left.source_end_ms.min(right.source_end_ms)
        - left.source_start_ms.max(right.source_start_ms))
    .max(0);
    let shorter = left.duration_ms.min(right.duration_ms).max(1);
    overlap as f64 / shorter as f64
}

pub fn analyze_candidates(
    input: CandidateAnalysisInputV1,
) -> Result<ViralCandidateAnalysisDocumentV1, &'static str> {
    input
        .transcript
        .validate()
        .map_err(|_| "invalid_transcript")?;
    if input.prompt_version.is_empty() || input.provider_name.is_empty() {
        return Err("invalid_provider_provenance");
    }
    let proposals = if input.proposals.is_empty() {
        fallback_proposals(&input.transcript)
    } else {
        input.proposals
    };
    let mut candidates = Vec::new();
    for proposal in proposals.into_iter().take(32) {
        let Some((start, end)) = snap_range(
            &input.transcript,
            proposal.source_start_ms,
            proposal.source_end_ms,
            &input.silence_boundaries_ms,
        ) else {
            continue;
        };
        let duration = end - start;
        if input.transcript.duration_ms >= MIN_CANDIDATE_MS
            && !(MIN_CANDIDATE_MS..=MAX_CANDIDATE_MS).contains(&duration)
        {
            continue;
        }
        let words = timed_words(&input.transcript);
        let selected_words: Vec<_> = words
            .iter()
            .filter(|word| {
                word.start_ms.unwrap_or_default() >= start && word.end_ms.unwrap_or_default() <= end
            })
            .collect();
        let word_ids = selected_words.iter().map(|word| word.id.clone()).collect();
        let selected_segments: Vec<_> = input
            .transcript
            .segments
            .iter()
            .filter(|segment| segment.start_ms < end && segment.end_ms > start)
            .collect();
        let segment_ids = selected_segments
            .iter()
            .map(|segment| segment.id.clone())
            .collect();
        let excerpt = truncate(
            &if selected_words.is_empty() {
                selected_segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            } else {
                selected_words
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            },
            280,
        );
        let breakdown = proposal.score_breakdown.normalized();
        let low_confidence_opening = selected_words
            .iter()
            .take(3)
            .any(|word| word.is_low_confidence || word.confidence.is_some_and(|value| value < 0.5));
        let mut score = breakdown.total();
        let mut warnings = Vec::new();
        if low_confidence_opening {
            score = score.saturating_sub(8);
            warnings.push("low_confidence_opening".into());
        }
        if breakdown.payoff < 8 {
            score = score.saturating_sub(5);
            warnings.push("weak_payoff_signal".into());
        }
        if selected_words
            .first()
            .and_then(|word| word.start_ms)
            .is_some_and(|word_start| word_start - start > 250)
        {
            score = score.saturating_sub(4);
            warnings.push("leading_silence".into());
        }
        let source_ratio = input
            .transcript
            .metadata
            .get("sourceAspectRatio")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        candidates.push(ViralCandidateV1 {
            candidate_id: String::new(),
            source_start_ms: start,
            source_end_ms: end,
            duration_ms: duration,
            title: truncate(&proposal.title, 80),
            hook_text: truncate(&proposal.hook_text, 120),
            supporting_emojis: proposal
                .supporting_emojis
                .into_iter()
                .filter(|value| !value.trim().is_empty())
                .take(2)
                .collect(),
            viral_score: score,
            score_breakdown: breakdown,
            reason: truncate(&proposal.reason, 500),
            transcript_evidence: TranscriptEvidenceV1 {
                word_ids,
                segment_ids,
                excerpt,
            },
            recommended_framing_strategy: if source_ratio == "9:16" {
                "preserve_vertical"
            } else {
                "automatic"
            }
            .into(),
            recommended_caption_preset: "word_highlight_box".into(),
            warnings,
        });
    }
    candidates.sort_by(|left, right| {
        right
            .viral_score
            .cmp(&left.viral_score)
            .then(left.source_start_ms.cmp(&right.source_start_ms))
            .then(left.source_end_ms.cmp(&right.source_end_ms))
    });
    let mut deduplicated: Vec<ViralCandidateV1> = Vec::new();
    for candidate in candidates {
        if deduplicated
            .iter()
            .any(|existing| overlap_ratio(existing, &candidate) >= 0.7)
        {
            continue;
        }
        deduplicated.push(candidate);
        if deduplicated.len() == MAX_CANDIDATES {
            break;
        }
    }
    for (index, candidate) in deduplicated.iter_mut().enumerate() {
        candidate.candidate_id = format!("candidate_{:03}", index + 1);
    }
    Ok(ViralCandidateAnalysisDocumentV1 {
        schema_version: CANDIDATE_SCHEMA_VERSION,
        transcript_id: input.transcript.transcript_id.clone(),
        media_id: input.transcript.media_id.clone(),
        duration_ms: input.transcript.duration_ms,
        prompt_version: input.prompt_version,
        provider: json!({
            "name": input.provider_name,
            "model": input.provider_model,
            "requestId": input.provider_request_id
        }),
        candidates: deduplicated,
        warnings: vec![],
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedFaceBoxV1 {
    pub time_ms: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub confidence: f64,
    #[serde(default)]
    pub track_id: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReframePlanningInputV1 {
    pub candidate_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub source_width: u32,
    pub source_height: u32,
    #[serde(default)]
    pub scene_boundaries_ms: Vec<i64>,
    #[serde(default)]
    pub detections: Vec<NormalizedFaceBoxV1>,
    #[serde(default)]
    pub detector_version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropKeyframeV1 {
    pub id: String,
    pub source_time_ms: i64,
    pub center_x: f64,
    pub center_y: f64,
    pub scale: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRegionV1 {
    pub id: String,
    pub role: String,
    pub source_center_x: f64,
    pub source_center_y: f64,
    pub output_center_x: f64,
    pub output_center_y: f64,
    pub output_width: f64,
    pub output_height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReframeShotV1 {
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub strategy: String,
    pub crop_keyframes: Vec<CropKeyframeV1>,
    #[serde(default)]
    pub layout_regions: Vec<LayoutRegionV1>,
    pub confidence: f64,
    pub reason_code: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReframePlanV1 {
    pub schema_version: u8,
    pub candidate_id: String,
    pub source_width: u32,
    pub source_height: u32,
    pub target_width: u32,
    pub target_height: u32,
    pub detector_version: Option<String>,
    pub shots: Vec<ReframeShotV1>,
    pub warnings: Vec<String>,
}

fn strategy_for(
    input: &ReframePlanningInputV1,
    detections: &[&NormalizedFaceBoxV1],
) -> (&'static str, f64, &'static str) {
    let ratio = input.source_width as f64 / input.source_height.max(1) as f64;
    if ratio <= 0.7 {
        return ("preserve_vertical", 1.0, "vertical_source");
    }
    let mut track_ids: Vec<_> = detections
        .iter()
        .filter(|item| item.confidence >= 0.5)
        .map(|item| item.track_id)
        .collect();
    track_ids.sort_unstable();
    track_ids.dedup();
    match track_ids.len() {
        1 if ratio > 1.2
            && detections
                .iter()
                .map(|item| item.width * item.height)
                .sum::<f64>()
                / (detections.len().max(1) as f64)
                < 0.08
            && detections.iter().any(|item| {
                let center = item.x + item.width / 2.0;
                !(0.3..=0.7).contains(&center)
            }) =>
        {
            (
                "speaker_screen_stack",
                0.68,
                "small_off_center_speaker_with_wide_content",
            )
        }
        1 => ("single_subject_crop", 0.85, "one_persistent_face"),
        2.. if ratio > 1.2 => ("dual_subject_split", 0.75, "multiple_persistent_faces"),
        2.. => (
            "fit_blurred_background",
            0.55,
            "multiple_faces_in_compact_source",
        ),
        _ => (
            "fit_blurred_background",
            0.4,
            "detector_unavailable_or_no_face",
        ),
    }
}

fn crop_keyframes(detections: &[&NormalizedFaceBoxV1], shot_index: usize) -> Vec<CropKeyframeV1> {
    let mut ordered = detections.to_vec();
    ordered.sort_by(|left, right| {
        left.time_ms
            .cmp(&right.time_ms)
            .then_with(|| left.x.partial_cmp(&right.x).unwrap_or(Ordering::Equal))
    });
    let mut result = Vec::new();
    let mut last_x = 0.5;
    let mut last_y = 0.45;
    let mut last_target: Option<(f64, f64)> = None;
    let mut last_time = i64::MIN / 2;
    for detection in ordered {
        if detection.time_ms - last_time < 500 {
            continue;
        }
        let desired_x = (detection.x + detection.width / 2.0).clamp(0.12, 0.88);
        let desired_y = (detection.y + detection.height * 0.45).clamp(0.12, 0.78);
        if last_target
            .is_some_and(|(x, y)| (desired_x - x).abs() < 0.03 && (desired_y - y).abs() < 0.03)
        {
            continue;
        }
        last_target = Some((desired_x, desired_y));
        let delta_x = desired_x - last_x;
        let delta_y = desired_y - last_y;
        if !result.is_empty() && delta_x.abs() < 0.03 && delta_y.abs() < 0.03 {
            continue;
        }
        last_x = (last_x + delta_x.clamp(-0.08, 0.08)).clamp(0.12, 0.88);
        last_y = (last_y + delta_y.clamp(-0.06, 0.06)).clamp(0.12, 0.78);
        last_time = detection.time_ms;
        result.push(CropKeyframeV1 {
            id: format!("crop_{shot_index:03}_{:03}", result.len() + 1),
            source_time_ms: detection.time_ms,
            center_x: (last_x * 10_000.0).round() / 10_000.0,
            center_y: (last_y * 10_000.0).round() / 10_000.0,
            scale: 1.0,
        });
    }
    result
}

fn layout_regions(
    detections: &[&NormalizedFaceBoxV1],
    strategy: &str,
    shot_index: usize,
) -> Vec<LayoutRegionV1> {
    let mut by_track = std::collections::BTreeMap::<u32, Vec<&NormalizedFaceBoxV1>>::new();
    for detection in detections
        .iter()
        .copied()
        .filter(|item| item.confidence >= 0.5)
    {
        by_track
            .entry(detection.track_id)
            .or_default()
            .push(detection);
    }
    let mut centers: Vec<_> = by_track
        .into_iter()
        .map(|(track_id, values)| {
            let count = values.len() as f64;
            (
                track_id,
                values
                    .iter()
                    .map(|item| item.x + item.width / 2.0)
                    .sum::<f64>()
                    / count,
                values
                    .iter()
                    .map(|item| item.y + item.height * 0.45)
                    .sum::<f64>()
                    / count,
            )
        })
        .collect();
    centers.sort_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    match strategy {
        "dual_subject_split" => centers
            .into_iter()
            .take(2)
            .enumerate()
            .map(|(index, (track, x, y))| LayoutRegionV1 {
                id: format!("layout_{shot_index:03}_subject_{track}"),
                role: format!("subject_{}", index + 1),
                source_center_x: x.clamp(0.1, 0.9),
                source_center_y: y.clamp(0.1, 0.9),
                output_center_x: 0.5,
                output_center_y: if index == 0 { 0.25 } else { 0.75 },
                output_width: 1.0,
                output_height: 0.5,
            })
            .collect(),
        "speaker_screen_stack" => centers
            .first()
            .map(|(track, x, y)| {
                vec![
                    LayoutRegionV1 {
                        id: format!("layout_{shot_index:03}_screen"),
                        role: "screen".into(),
                        source_center_x: 0.5,
                        source_center_y: 0.5,
                        output_center_x: 0.5,
                        output_center_y: 0.3,
                        output_width: 1.0,
                        output_height: 0.6,
                    },
                    LayoutRegionV1 {
                        id: format!("layout_{shot_index:03}_speaker_{track}"),
                        role: "speaker".into(),
                        source_center_x: x.clamp(0.1, 0.9),
                        source_center_y: y.clamp(0.1, 0.9),
                        output_center_x: 0.5,
                        output_center_y: 0.8,
                        output_width: 1.0,
                        output_height: 0.4,
                    },
                ]
            })
            .unwrap_or_default(),
        _ => vec![],
    }
}

pub fn plan_reframe(input: ReframePlanningInputV1) -> Result<ReframePlanV1, &'static str> {
    if input.candidate_id.is_empty()
        || input.source_width == 0
        || input.source_height == 0
        || input.source_start_ms < 0
        || input.source_end_ms <= input.source_start_ms
    {
        return Err("invalid_reframe_input");
    }
    if input.detections.iter().any(|item| {
        item.time_ms < input.source_start_ms
            || item.time_ms > input.source_end_ms
            || !(0.0..=1.0).contains(&item.x)
            || !(0.0..=1.0).contains(&item.y)
            || item.width <= 0.0
            || item.height <= 0.0
            || item.x + item.width > 1.0001
            || item.y + item.height > 1.0001
            || !(0.0..=1.0).contains(&item.confidence)
    }) {
        return Err("invalid_detection");
    }
    let mut boundaries = vec![input.source_start_ms];
    boundaries.extend(input.scene_boundaries_ms.iter().copied().filter(|value| {
        *value > input.source_start_ms + 750 && *value < input.source_end_ms - 750
    }));
    boundaries.push(input.source_end_ms);
    boundaries.sort_unstable();
    boundaries.dedup();
    let mut shots = Vec::new();
    for (shot_index, window) in boundaries.windows(2).enumerate() {
        let detections: Vec<_> = input
            .detections
            .iter()
            .filter(|item| item.time_ms >= window[0] && item.time_ms < window[1])
            .collect();
        let (strategy, confidence, reason) = strategy_for(&input, &detections);
        let regions = layout_regions(&detections, strategy, shot_index + 1);
        shots.push(ReframeShotV1 {
            source_start_ms: window[0],
            source_end_ms: window[1],
            strategy: strategy.into(),
            crop_keyframes: if strategy == "single_subject_crop" {
                crop_keyframes(&detections, shot_index + 1)
            } else {
                vec![]
            },
            layout_regions: regions,
            confidence,
            reason_code: reason.into(),
        });
    }
    let mut merged: Vec<ReframeShotV1> = Vec::new();
    for shot in shots {
        if let Some(previous) = merged.last_mut()
            && previous.strategy == shot.strategy
            && previous.crop_keyframes.is_empty()
            && shot.crop_keyframes.is_empty()
            && previous.layout_regions.is_empty()
            && shot.layout_regions.is_empty()
            && (previous.source_end_ms - previous.source_start_ms < 1_500
                || shot.source_end_ms - shot.source_start_ms < 1_500)
        {
            previous.source_end_ms = shot.source_end_ms;
            previous.confidence = previous.confidence.min(shot.confidence);
            previous.reason_code = "merged_equivalent_short_scene".into();
            continue;
        }
        merged.push(shot);
    }
    let warnings = if input.detector_version.is_none() {
        vec!["face_detector_unavailable".into()]
    } else {
        vec![]
    };
    Ok(ReframePlanV1 {
        schema_version: REFRAME_SCHEMA_VERSION,
        candidate_id: input.candidate_id,
        source_width: input.source_width,
        source_height: input.source_height,
        target_width: 1080,
        target_height: 1920,
        detector_version: input.detector_version,
        shots: merged,
        warnings,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HookOverlayV1 {
    pub text: String,
    #[serde(default)]
    pub supporting_emojis: Vec<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub position: String,
    pub maximum_lines: u8,
    pub style_preset: String,
    pub animation_preset: String,
    pub safe_zone_profile: String,
    pub transcript_evidence: TranscriptEvidenceV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortCompositionInputV1 {
    pub base_project: ClipProjectV1,
    pub candidate: ViralCandidateV1,
    pub reframe_plan: ReframePlanV1,
    pub hook_overlay: HookOverlayV1,
    pub caption_preset: String,
    pub word_spacing: f64,
    pub expected_revision: u64,
    #[serde(default)]
    pub accepted_silence_intervals: Vec<AcceptedSilenceIntervalV1>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedSilenceIntervalV1 {
    pub source_start_ms: i64,
    pub source_end_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortCompositionResultV1 {
    pub project: ClipProjectV1,
    pub composition_report: Value,
    pub warnings: Vec<String>,
}

pub fn compose_short(
    input: ShortCompositionInputV1,
) -> Result<ShortCompositionResultV1, &'static str> {
    if input.base_project.revision != input.expected_revision {
        return Err("stale_project_revision");
    }
    if input.candidate.supporting_emojis.len() > 2
        || input.hook_overlay.supporting_emojis.len() > 2
        || input.hook_overlay.start_ms < 0
        || input.hook_overlay.end_ms <= input.hook_overlay.start_ms
        || input.hook_overlay.end_ms > input.candidate.duration_ms
        || !input.word_spacing.is_finite()
        || !(-10.0..=100.0).contains(&input.word_spacing)
        || input.accepted_silence_intervals.iter().any(|interval| {
            interval.source_start_ms < input.candidate.source_start_ms
                || interval.source_end_ms > input.candidate.source_end_ms
                || interval.source_end_ms <= interval.source_start_ms
        })
    {
        return Err("invalid_composition");
    }
    let profile = safe_zone_profile(&input.hook_overlay.safe_zone_profile);
    let mut project = input.base_project;
    project.revision = project.revision.saturating_add(1);
    project.status = "draft".into();
    project.canvas = ClipCanvasV1 {
        aspect_ratio: "9:16".into(),
        width: 1080,
        height: 1920,
        background: Some("#000000".into()),
        safe_area: Some(json!(profile)),
        metadata: json!({}),
    };
    let mut silences = input.accepted_silence_intervals;
    silences.sort_by_key(|item| (item.source_start_ms, item.source_end_ms));
    let mut merged_silences: Vec<AcceptedSilenceIntervalV1> = Vec::new();
    for silence in silences {
        if let Some(previous) = merged_silences.last_mut()
            && silence.source_start_ms <= previous.source_end_ms
        {
            previous.source_end_ms = previous.source_end_ms.max(silence.source_end_ms);
        } else {
            merged_silences.push(silence);
        }
    }
    let mut included = Vec::new();
    let mut cursor = input.candidate.source_start_ms;
    for silence in &merged_silences {
        if silence.source_start_ms - cursor >= 100 {
            included.push((cursor, silence.source_start_ms));
        }
        cursor = cursor.max(silence.source_end_ms);
    }
    if input.candidate.source_end_ms - cursor >= 100 {
        included.push((cursor, input.candidate.source_end_ms));
    }
    if included.is_empty() {
        return Err("invalid_composition");
    }
    project.ranges = included
        .into_iter()
        .enumerate()
        .map(|(index, (start, end))| ClipRangeV1 {
            schema_version: 1,
            id: format!("range_{}_{:03}", input.candidate.candidate_id, index + 1),
            source_media_id: project.source_media.media_id.clone(),
            source_start_ms: start,
            source_end_ms: end,
            order: index as u64,
            playback_rate: 1.0,
            selection: (merged_silences.is_empty()).then(|| ClipSelectionReferenceV1 {
                transcript_id: project.transcript_id.clone(),
                transcript_revision: project.transcript_revision,
                start_word_id: input
                    .candidate
                    .transcript_evidence
                    .word_ids
                    .first()
                    .cloned(),
                end_word_id: input.candidate.transcript_evidence.word_ids.last().cloned(),
                start_segment_id: input
                    .candidate
                    .transcript_evidence
                    .segment_ids
                    .first()
                    .cloned(),
                end_segment_id: input
                    .candidate
                    .transcript_evidence
                    .segment_ids
                    .last()
                    .cloned(),
            }),
            boundary: ClipBoundaryV1::default(),
            transition_in: None,
            transition_out: None,
            enabled: true,
            label: (index == 0).then(|| input.candidate.title.clone()),
            metadata: json!({
                "candidateId": input.candidate.candidate_id,
                "acceptedSilenceApplied": !merged_silences.is_empty()
            }),
        })
        .collect();
    project.caption_track = Some(CaptionTrackReferenceV1 {
        caption_track_id: format!("captions_{}", input.candidate.candidate_id),
        transcript_id: project.transcript_id.clone(),
        style_preset_id: Some(input.caption_preset.clone()),
        enabled: true,
        metadata: json!({"wordSpacing": input.word_spacing, "maximumLines": 2}),
    });
    project.settings = ClipProjectSettingsV1 {
        metadata: json!({"safeZoneProfile": input.hook_overlay.safe_zone_profile}),
        ..project.settings
    };
    project.metadata = json!({
        "automaticClipper": {
            "schemaVersion": 1,
            "candidateId": input.candidate.candidate_id,
            "reframePlan": input.reframe_plan,
            "hookOverlay": input.hook_overlay,
            "safeZone": profile,
            "captionComposition": {
                "preset": input.caption_preset,
                "wordSpacing": input.word_spacing,
                "maximumLines": 2,
                "positionY": profile.caption_position_percent,
                "maximumWidth": 82
            }
        }
    });
    project.validate().map_err(|_| "invalid_clip_project")?;
    Ok(ShortCompositionResultV1 {
        composition_report: json!({
            "candidateId": input.candidate.candidate_id,
            "projectRevision": project.revision,
            "rangeCount": project.ranges.len(),
            "target": "9:16",
            "editable": true
        }),
        project,
        warnings: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(time_ms: i64, x: f64, track_id: u32) -> NormalizedFaceBoxV1 {
        NormalizedFaceBoxV1 {
            time_ms,
            x,
            y: 0.2,
            width: 0.2,
            height: 0.3,
            confidence: 0.9,
            track_id,
        }
    }

    #[test]
    fn smoothing_uses_dead_zone_and_velocity_limit() {
        let input = ReframePlanningInputV1 {
            candidate_id: "candidate_001".into(),
            source_start_ms: 0,
            source_end_ms: 10_000,
            source_width: 1920,
            source_height: 1080,
            scene_boundaries_ms: vec![],
            detections: vec![
                NormalizedFaceBoxV1 {
                    time_ms: 0,
                    x: 0.1,
                    y: 0.2,
                    width: 0.3,
                    height: 0.4,
                    confidence: 0.9,
                    track_id: 1,
                },
                NormalizedFaceBoxV1 {
                    time_ms: 600,
                    x: 0.11,
                    y: 0.2,
                    width: 0.3,
                    height: 0.4,
                    confidence: 0.9,
                    track_id: 1,
                },
                NormalizedFaceBoxV1 {
                    time_ms: 1_200,
                    x: 0.6,
                    y: 0.2,
                    width: 0.3,
                    height: 0.4,
                    confidence: 0.9,
                    track_id: 1,
                },
            ],
            detector_version: Some("fixture".into()),
        };
        let plan = plan_reframe(input).unwrap();
        let keys = &plan.shots[0].crop_keyframes;
        assert_eq!(keys.len(), 2);
        assert!((keys[1].center_x - keys[0].center_x).abs() <= 0.0801);
    }

    #[test]
    fn detector_unavailable_is_safe_blur_fallback() {
        let plan = plan_reframe(ReframePlanningInputV1 {
            candidate_id: "candidate_001".into(),
            source_start_ms: 0,
            source_end_ms: 5_000,
            source_width: 1920,
            source_height: 1080,
            scene_boundaries_ms: vec![],
            detections: vec![],
            detector_version: None,
        })
        .unwrap();
        assert_eq!(plan.shots[0].strategy, "fit_blurred_background");
        assert_eq!(plan.warnings, ["face_detector_unavailable"]);
    }

    #[test]
    fn ratio_and_subject_heuristics_select_controlled_layouts() {
        let plan = |width, height, detections| {
            plan_reframe(ReframePlanningInputV1 {
                candidate_id: "candidate_ratio".into(),
                source_start_ms: 0,
                source_end_ms: 8_000,
                source_width: width,
                source_height: height,
                scene_boundaries_ms: vec![],
                detections,
                detector_version: Some("fixture".into()),
            })
            .unwrap()
        };
        assert_eq!(
            plan(1080, 1920, vec![]).shots[0].strategy,
            "preserve_vertical"
        );
        assert_eq!(
            plan(1080, 1080, vec![face(0, 0.4, 1)]).shots[0].strategy,
            "single_subject_crop"
        );
        let dual = plan(1920, 1080, vec![face(0, 0.15, 1), face(0, 0.65, 2)]);
        assert_eq!(dual.shots[0].strategy, "dual_subject_split");
        assert_eq!(dual.shots[0].layout_regions.len(), 2);
        let screen = plan(1920, 1080, vec![face(0, 0.05, 1)]);
        assert_eq!(screen.shots[0].strategy, "speaker_screen_stack");
        assert_eq!(screen.shots[0].layout_regions.len(), 2);
    }

    #[test]
    fn candidate_normalization_snaps_safely_deduplicates_and_penalizes_confidence() {
        let mut transcript: TranscriptDocumentV2 = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/transcript-document-v2/english-words.json"
        ))
        .unwrap();
        transcript.words[0].is_low_confidence = true;
        let proposal = ViralCandidateProposalV1 {
            source_start_ms: 250,
            source_end_ms: 1_000,
            title: "Synthetic title".into(),
            hook_text: "Synthetic hook".into(),
            supporting_emojis: vec!["👨🏽‍💻".into(), "✨".into(), "ignored".into()],
            score_breakdown: CandidateScoreBreakdownV1 {
                hook_strength: 20,
                clarity: 20,
                payoff: 20,
                emotion: 20,
                novelty: 20,
            },
            reason: "fixture".into(),
        };
        let document = analyze_candidates(CandidateAnalysisInputV1 {
            transcript,
            proposals: vec![proposal.clone(), proposal],
            silence_boundaries_ms: vec![250, 800],
            prompt_version: "viral-candidates-v1".into(),
            provider_name: "fixture".into(),
            provider_model: None,
            provider_request_id: None,
        })
        .unwrap();
        assert_eq!(document.candidates.len(), 1);
        let candidate = &document.candidates[0];
        assert_eq!(
            (candidate.source_start_ms, candidate.source_end_ms),
            (0, 1_200)
        );
        assert_eq!(candidate.viral_score, 92);
        assert_eq!(candidate.supporting_emojis, ["👨🏽‍💻", "✨"]);
        assert_eq!(candidate.warnings, ["low_confidence_opening"]);

        let mut transcript: TranscriptDocumentV2 = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/transcript-document-v2/english-words.json"
        ))
        .unwrap();
        transcript.words[0].is_low_confidence = false;
        let snapped = analyze_candidates(CandidateAnalysisInputV1 {
            transcript,
            proposals: vec![ViralCandidateProposalV1 {
                source_start_ms: 510,
                source_end_ms: 1_200,
                title: "Boundary".into(),
                hook_text: "Boundary".into(),
                supporting_emojis: vec![],
                score_breakdown: CandidateScoreBreakdownV1::default(),
                reason: "fixture".into(),
            }],
            silence_boundaries_ms: vec![505],
            prompt_version: "viral-candidates-v1".into(),
            provider_name: "fixture".into(),
            provider_model: None,
            provider_request_id: None,
        })
        .unwrap();
        assert_eq!(snapped.candidates[0].source_start_ms, 505);
    }

    #[test]
    fn multilingual_transcripts_preserve_evidence_without_language_specific_logic() {
        let fixtures = [
            include_str!(
                "../../../../contracts/fixtures/transcript-document-v2/english-words.json"
            ),
            include_str!("../../../../contracts/fixtures/transcript-document-v2/hinglish.json"),
            include_str!(
                "../../../../contracts/fixtures/transcript-document-v2/telgish-manual.json"
            ),
        ];
        for fixture in fixtures {
            let transcript: TranscriptDocumentV2 = serde_json::from_str(fixture).unwrap();
            let start = transcript.segments.first().unwrap().start_ms;
            let end = transcript.segments.last().unwrap().end_ms;
            let document = analyze_candidates(CandidateAnalysisInputV1 {
                transcript,
                proposals: vec![ViralCandidateProposalV1 {
                    source_start_ms: start,
                    source_end_ms: end,
                    title: "Synthetic title".into(),
                    hook_text: "Synthetic hook".into(),
                    supporting_emojis: vec![],
                    score_breakdown: CandidateScoreBreakdownV1::default(),
                    reason: "multilingual fixture".into(),
                }],
                silence_boundaries_ms: vec![],
                prompt_version: "viral-candidates-v1".into(),
                provider_name: "fixture".into(),
                provider_model: None,
                provider_request_id: None,
            })
            .unwrap();
            assert!(
                !document.candidates[0]
                    .transcript_evidence
                    .excerpt
                    .is_empty()
            );
            assert!(
                !document.candidates[0]
                    .transcript_evidence
                    .segment_ids
                    .is_empty()
            );
        }

        let mut hindi: TranscriptDocumentV2 = serde_json::from_str(fixtures[1]).unwrap();
        hindi.detected_languages = vec!["hi".into()];
        hindi.segments[0].text = "\u{092f}\u{0939} \u{0935}\u{093f}\u{091a}\u{093e}\u{0930} \
             \u{092c}\u{0939}\u{0941}\u{0924} \u{0909}\u{092a}\u{092f}\u{094b}\u{0917}\u{0940} \
             \u{0939}\u{0948}\u{0964}"
            .into();
        let expected_hindi = hindi.segments[0].text.clone();
        hindi.words.clear();
        for segment in &mut hindi.segments {
            segment.word_ids.clear();
        }
        let document = analyze_candidates(CandidateAnalysisInputV1 {
            proposals: vec![ViralCandidateProposalV1 {
                source_start_ms: 0,
                source_end_ms: 1_000,
                title: "Synthetic title".into(),
                hook_text: "Synthetic hook".into(),
                supporting_emojis: vec![],
                score_breakdown: CandidateScoreBreakdownV1::default(),
                reason: "Hindi fixture".into(),
            }],
            transcript: hindi,
            silence_boundaries_ms: vec![],
            prompt_version: "viral-candidates-v1".into(),
            provider_name: "fixture".into(),
            provider_model: None,
            provider_request_id: None,
        })
        .unwrap();
        assert!(
            document.candidates[0]
                .transcript_evidence
                .excerpt
                .contains(&expected_hindi)
        );
    }

    #[test]
    fn thirty_minute_fallback_is_bounded_and_deterministic() {
        let mut transcript: TranscriptDocumentV2 = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/transcript-document-v2/english-words.json"
        ))
        .unwrap();
        let segment_template = transcript.segments[0].clone();
        let word_templates = transcript.words.clone();
        transcript.duration_ms = 1_800_000;
        transcript.segments.clear();
        transcript.words.clear();
        for index in 0..90 {
            let start = index * 20_000;
            let segment_id = format!("seg_{index:06}");
            let word_ids = vec![format!("word_{index:06}_a"), format!("word_{index:06}_b")];
            let mut segment = segment_template.clone();
            segment.id = segment_id.clone();
            segment.start_ms = start;
            segment.end_ms = start + 20_000;
            segment.text = format!("Synthetic complete idea {index}.");
            segment.word_ids = word_ids.clone();
            transcript.segments.push(segment);
            for (word_index, template) in word_templates.iter().enumerate() {
                let mut word = template.clone();
                word.id = word_ids[word_index].clone();
                word.segment_id = segment_id.clone();
                word.start_ms = Some(start + word_index as i64 * 10_000);
                word.end_ms = Some(start + (word_index as i64 + 1) * 10_000);
                transcript.words.push(word);
            }
        }
        let input = CandidateAnalysisInputV1 {
            transcript,
            proposals: vec![],
            silence_boundaries_ms: vec![],
            prompt_version: "viral-candidates-v1".into(),
            provider_name: "deterministic".into(),
            provider_model: None,
            provider_request_id: None,
        };
        let first = analyze_candidates(input.clone()).unwrap();
        let second = analyze_candidates(input).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.duration_ms, 1_800_000);
        assert!(first.candidates.len() <= MAX_CANDIDATES);
        assert!(
            first
                .candidates
                .iter()
                .all(|item| item.duration_ms <= 90_000)
        );
    }

    #[test]
    fn safe_zone_profiles_are_versioned_and_unknown_values_fall_back() {
        assert_eq!(safe_zone_profile("tiktok-v1").id, "tiktok-v1");
        let fallback = safe_zone_profile("future-platform");
        assert_eq!(fallback.schema_version, 1);
        assert_eq!(fallback.id, "shorts-generic-v1");
        assert!(fallback.caption_position_percent <= 100);
    }

    #[test]
    fn segment_only_transcripts_produce_evidenced_candidates_without_invented_words() {
        let mut transcript: TranscriptDocumentV2 = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/transcript-document-v2/english-words.json"
        ))
        .unwrap();
        transcript.words.clear();
        transcript.segments[0].word_ids.clear();
        let result = analyze_candidates(CandidateAnalysisInputV1 {
            transcript,
            proposals: vec![ViralCandidateProposalV1 {
                source_start_ms: 0,
                source_end_ms: 1_200,
                title: "Segment only".into(),
                hook_text: "Segment only".into(),
                supporting_emojis: vec![],
                score_breakdown: CandidateScoreBreakdownV1::default(),
                reason: "fixture".into(),
            }],
            silence_boundaries_ms: vec![],
            prompt_version: "viral-candidates-v1".into(),
            provider_name: "fixture".into(),
            provider_model: None,
            provider_request_id: None,
        })
        .unwrap();
        assert_eq!(result.candidates.len(), 1);
        assert!(result.candidates[0].transcript_evidence.word_ids.is_empty());
        assert_eq!(
            result.candidates[0].transcript_evidence.segment_ids,
            ["seg_000001"]
        );
        assert_eq!(
            result.candidates[0].transcript_evidence.excerpt,
            "Hello world."
        );
    }
}

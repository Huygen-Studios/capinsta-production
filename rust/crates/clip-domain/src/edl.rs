use crate::{ClipProjectV1, ValidationIssue};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PLAYBACK_RATE_SCALE: i128 = 1_000_000;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlaybackRate(pub i128);
impl PlaybackRate {
    pub fn from_contract(value: f64) -> Result<Self, ValidationIssue> {
        if !value.is_finite() || !(0.25..=4.0).contains(&value) {
            return Err(issue("invalid_playback_rate", "ranges.playbackRate", None));
        }
        let units = (value * PLAYBACK_RATE_SCALE as f64).round() as i128;
        if units <= 0 {
            return Err(issue("invalid_playback_rate", "ranges.playbackRate", None));
        }
        Ok(Self(units))
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdlEntryV1 {
    pub id: String,
    pub range_id: String,
    pub order: u64,
    pub source_media_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub source_duration_ms: i64,
    pub output_start_ms: i64,
    pub output_end_ms: i64,
    pub output_duration_ms: i64,
    pub playback_rate: f64,
    pub transition_in: Option<Value>,
    pub transition_out: Option<Value>,
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditDecisionListV1 {
    pub schema_version: u8,
    pub clip_project_id: String,
    pub project_revision: u64,
    pub source_media_id: String,
    pub source_duration_ms: i64,
    pub output_duration_ms: i64,
    pub entries: Vec<EdlEntryV1>,
    pub warnings: Vec<DomainWarning>,
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainWarning {
    pub category: String,
    pub message: String,
    pub range_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceToOutputMatch {
    pub range_id: String,
    pub output_time_ms: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputToSourceMatch {
    pub range_id: String,
    pub source_media_id: String,
    pub source_time_ms: i64,
}
fn issue(category: &str, path: &str, id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        category: category.into(),
        field_path: path.into(),
        entity_id: id,
        message: category.into(),
    }
}
fn round_half_up(numerator: i128, denominator: i128) -> Result<i64, ValidationIssue> {
    let value = numerator
        .checked_add(denominator / 2)
        .ok_or_else(|| issue("arithmetic_overflow", "outputDurationMs", None))?
        / denominator;
    i64::try_from(value).map_err(|_| issue("arithmetic_overflow", "outputDurationMs", None))
}
/// Produces derived, contiguous output boundaries by rounding exact cumulative boundaries once.
pub fn generate_edit_decision_list(
    project: &ClipProjectV1,
) -> Result<EditDecisionListV1, Vec<ValidationIssue>> {
    project.validate().map_err(|x| vec![x])?;
    let mut ranges: Vec<_> = project.ranges.iter().filter(|r| r.enabled).collect();
    ranges.sort_by_key(|r| r.order);
    let mut exact: i128 = 0;
    let mut previous = 0_i64;
    let mut entries = Vec::with_capacity(ranges.len());
    for range in ranges {
        let rate = PlaybackRate::from_contract(range.playback_rate).map_err(|x| vec![x])?;
        let source = (range.source_end_ms - range.source_start_ms) as i128;
        let increment = source.checked_mul(PLAYBACK_RATE_SCALE).ok_or_else(|| {
            vec![issue(
                "arithmetic_overflow",
                "ranges",
                Some(range.id.clone()),
            )]
        })?;
        let exact_increment = increment
            .checked_mul(PLAYBACK_RATE_SCALE)
            .ok_or_else(|| {
                vec![issue(
                    "arithmetic_overflow",
                    "ranges",
                    Some(range.id.clone()),
                )]
            })?
            .checked_div(rate.0)
            .ok_or_else(|| {
                vec![issue(
                    "arithmetic_overflow",
                    "ranges",
                    Some(range.id.clone()),
                )]
            })?;
        exact = exact.checked_add(exact_increment).ok_or_else(|| {
            vec![issue(
                "arithmetic_overflow",
                "ranges",
                Some(range.id.clone()),
            )]
        })?;
        let boundary = round_half_up(exact, PLAYBACK_RATE_SCALE).map_err(|x| vec![x])?;
        entries.push(EdlEntryV1 {
            id: format!("edl_{}", range.id),
            range_id: range.id.clone(),
            order: range.order,
            source_media_id: range.source_media_id.clone(),
            source_start_ms: range.source_start_ms,
            source_end_ms: range.source_end_ms,
            source_duration_ms: range.source_end_ms - range.source_start_ms,
            output_start_ms: previous,
            output_end_ms: boundary,
            output_duration_ms: boundary - previous,
            playback_rate: range.playback_rate,
            transition_in: range.transition_in.clone(),
            transition_out: range.transition_out.clone(),
            metadata: range.metadata.clone(),
        });
        previous = boundary;
    }
    let warnings = if entries.is_empty() {
        vec![DomainWarning {
            category: if project.ranges.is_empty() {
                "empty_output"
            } else {
                "all_ranges_disabled"
            }
            .into(),
            message: "No enabled ranges contribute to output.".into(),
            range_id: None,
        }]
    } else {
        vec![]
    };
    Ok(EditDecisionListV1 {
        schema_version: 1,
        clip_project_id: project.clip_project_id.clone(),
        project_revision: project.revision,
        source_media_id: project.source_media.media_id.clone(),
        source_duration_ms: project.source_media.duration_ms,
        output_duration_ms: previous,
        entries,
        warnings,
        metadata: project.metadata.clone(),
    })
}
pub fn map_source_time_to_output(
    edl: &EditDecisionListV1,
    media_id: &str,
    source_time_ms: i64,
) -> Result<Vec<SourceToOutputMatch>, ValidationIssue> {
    if media_id != edl.source_media_id
        || source_time_ms < 0
        || source_time_ms > edl.source_duration_ms
    {
        return Err(issue("source_time_out_of_bounds", "sourceTimeMs", None));
    }
    Ok(edl
        .entries
        .iter()
        .filter(|e| source_time_ms >= e.source_start_ms && source_time_ms < e.source_end_ms)
        .map(|e| SourceToOutputMatch {
            range_id: e.range_id.clone(),
            output_time_ms: e.output_start_ms
                + round_half_up(
                    ((source_time_ms - e.source_start_ms) as i128) * PLAYBACK_RATE_SCALE,
                    (e.playback_rate * PLAYBACK_RATE_SCALE as f64).round() as i128,
                )
                .unwrap_or(e.output_duration_ms),
        })
        .collect())
}
pub fn map_output_time_to_source(
    edl: &EditDecisionListV1,
    output_time_ms: i64,
) -> Result<OutputToSourceMatch, ValidationIssue> {
    if output_time_ms < 0 || output_time_ms > edl.output_duration_ms {
        return Err(issue("output_time_out_of_bounds", "outputTimeMs", None));
    }
    let entry = if output_time_ms == edl.output_duration_ms {
        edl.entries.last()
    } else {
        edl.entries
            .iter()
            .find(|e| output_time_ms >= e.output_start_ms && output_time_ms < e.output_end_ms)
    }
    .ok_or_else(|| issue("mapping_not_found", "outputTimeMs", None))?;
    let offset = output_time_ms - entry.output_start_ms;
    let source = entry.source_start_ms
        + round_half_up(
            (offset as i128) * (entry.playback_rate * PLAYBACK_RATE_SCALE as f64).round() as i128,
            PLAYBACK_RATE_SCALE,
        )
        .map_err(|x| x)?;
    Ok(OutputToSourceMatch {
        range_id: entry.range_id.clone(),
        source_media_id: entry.source_media_id.clone(),
        source_time_ms: source.min(entry.source_end_ms),
    })
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceIntervalOutputMatch {
    pub range_id: String,
    pub source_media_id: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub output_start_ms: i64,
    pub output_end_ms: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputIntervalSourceMatch {
    pub range_id: String,
    pub source_media_id: String,
    pub output_start_ms: i64,
    pub output_end_ms: i64,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
}
fn check_interval(start: i64, end: i64, maximum: i64, path: &str) -> Result<(), ValidationIssue> {
    if start < 0 || end <= start {
        return Err(issue("invalid_interval", path, None));
    }
    if end > maximum {
        return Err(issue(
            if path.starts_with("source") {
                "source_time_out_of_bounds"
            } else {
                "output_time_out_of_bounds"
            },
            path,
            None,
        ));
    }
    Ok(())
}
fn rate_units(rate: f64) -> i128 {
    (rate * PLAYBACK_RATE_SCALE as f64).round() as i128
}
pub(crate) fn source_to_output(entry: &EdlEntryV1, source: i64) -> Result<i64, ValidationIssue> {
    Ok(entry.output_start_ms
        + round_half_up(
            ((source - entry.source_start_ms) as i128) * PLAYBACK_RATE_SCALE,
            rate_units(entry.playback_rate),
        )?)
}
fn output_to_source(entry: &EdlEntryV1, output: i64) -> Result<i64, ValidationIssue> {
    Ok((entry.source_start_ms
        + round_half_up(
            ((output - entry.output_start_ms) as i128) * rate_units(entry.playback_rate),
            PLAYBACK_RATE_SCALE,
        )?)
    .min(entry.source_end_ms))
}
pub fn map_source_interval_to_output(
    edl: &EditDecisionListV1,
    media_id: &str,
    start: i64,
    end: i64,
) -> Result<Vec<SourceIntervalOutputMatch>, ValidationIssue> {
    if media_id != edl.source_media_id {
        return Err(issue("media_reference_mismatch", "sourceMediaId", None));
    }
    check_interval(start, end, edl.source_duration_ms, "sourceInterval")?;
    edl.entries
        .iter()
        .filter_map(|e| {
            let a = start.max(e.source_start_ms);
            let b = end.min(e.source_end_ms);
            (a < b).then(|| {
                Ok(SourceIntervalOutputMatch {
                    range_id: e.range_id.clone(),
                    source_media_id: e.source_media_id.clone(),
                    source_start_ms: a,
                    source_end_ms: b,
                    output_start_ms: source_to_output(e, a)?,
                    output_end_ms: source_to_output(e, b)?,
                })
            })
        })
        .collect()
}
pub fn map_output_interval_to_source(
    edl: &EditDecisionListV1,
    start: i64,
    end: i64,
) -> Result<Vec<OutputIntervalSourceMatch>, ValidationIssue> {
    check_interval(start, end, edl.output_duration_ms, "outputInterval")?;
    edl.entries
        .iter()
        .filter_map(|e| {
            let a = start.max(e.output_start_ms);
            let b = end.min(e.output_end_ms);
            (a < b).then(|| {
                Ok(OutputIntervalSourceMatch {
                    range_id: e.range_id.clone(),
                    source_media_id: e.source_media_id.clone(),
                    output_start_ms: a,
                    output_end_ms: b,
                    source_start_ms: output_to_source(e, a)?,
                    source_end_ms: output_to_source(e, b)?,
                })
            })
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;
    use serde_json::Value;
    fn project(rate: f64) -> ClipProjectV1 {
        ClipProjectV1 {
            schema_version: 1,
            clip_project_id: "p".into(),
            workspace_id: None,
            name: "p".into(),
            source_media: SourceMediaReferenceV1 {
                media_id: "m".into(),
                duration_ms: 10_000,
                source_type: SourceType::Uploaded,
                display_name: None,
                mime_type: None,
                storage_key: None,
                checksum: None,
                metadata: Value::Object(Default::default()),
            },
            transcript_id: None,
            transcript_revision: None,
            ranges: vec![ClipRangeV1 {
                schema_version: 1,
                id: "r".into(),
                source_media_id: "m".into(),
                source_start_ms: 1000,
                source_end_ms: 2000,
                order: 0,
                playback_rate: rate,
                selection: None,
                boundary: Default::default(),
                transition_in: None,
                transition_out: None,
                enabled: true,
                label: None,
                metadata: Value::Object(Default::default()),
            }],
            canvas: ClipCanvasV1 {
                aspect_ratio: "1:1".into(),
                width: 1,
                height: 1,
                background: None,
                safe_area: None,
                metadata: Value::Object(Default::default()),
            },
            caption_track: None,
            settings: Default::default(),
            status: "draft".into(),
            revision: 1,
            metadata: Value::Object(Default::default()),
            created_at: "x".into(),
            updated_at: "x".into(),
        }
    }
    #[test]
    fn speed_and_mapping() {
        let e = generate_edit_decision_list(&project(2.)).unwrap();
        assert_eq!(e.output_duration_ms, 500);
        assert_eq!(
            map_source_time_to_output(&e, "m", 1500).unwrap()[0].output_time_ms,
            250
        );
        assert_eq!(
            map_output_time_to_source(&e, 500).unwrap().source_time_ms,
            2000
        )
    }
    #[test]
    fn cumulative_rounding_is_gapless_and_deterministic() {
        let mut p = project(1.5);
        p.ranges = (0..1000)
            .map(|i| ClipRangeV1 {
                id: format!("r{i}"),
                order: i,
                source_start_ms: i as i64,
                source_end_ms: i as i64 + 1,
                ..p.ranges[0].clone()
            })
            .collect();
        p.source_media.duration_ms = 1000;
        let first = generate_edit_decision_list(&p).unwrap();
        let second = generate_edit_decision_list(&p).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.entries.first().unwrap().output_start_ms, 0);
        assert_eq!(
            first.entries.last().unwrap().output_end_ms,
            first.output_duration_ms
        );
        assert_eq!(
            first
                .entries
                .iter()
                .map(|e| e.output_duration_ms)
                .sum::<i64>(),
            first.output_duration_ms
        );
        assert!(
            first
                .entries
                .windows(2)
                .all(|w| w[0].output_end_ms == w[1].output_start_ms)
        );
    }
    #[test]
    fn explicit_order_beats_input_order_and_repeated_ranges_map_twice() {
        let mut p = project(1.0);
        let mut later = p.ranges[0].clone();
        later.id = "later".into();
        later.order = 1;
        let mut first = p.ranges[0].clone();
        first.id = "first".into();
        first.order = 0;
        p.ranges = vec![later, first];
        let edl = generate_edit_decision_list(&p).unwrap();
        assert_eq!(edl.entries[0].range_id, "first");
        assert_eq!(map_source_time_to_output(&edl, "m", 1500).unwrap().len(), 2);
    }
    #[test]
    fn mixed_rates_accumulate_each_range_at_its_own_rate() {
        let mut p = project(1.0);
        p.ranges = [0.75, 1.0, 1.25, 2.0]
            .into_iter()
            .enumerate()
            .map(|(i, rate)| ClipRangeV1 {
                id: format!("mixed_{i}"),
                order: i as u64,
                source_start_ms: i as i64 * 300,
                source_end_ms: i as i64 * 300 + 300,
                playback_rate: rate,
                ..p.ranges[0].clone()
            })
            .collect();
        assert_eq!(
            generate_edit_decision_list(&p).unwrap().output_duration_ms,
            1090
        );
    }
    #[test]
    #[ignore]
    fn performance_smoke_10000_ranges() {
        let mut p = project(1.25);
        p.ranges = (0..10_000)
            .map(|i| ClipRangeV1 {
                id: format!("r{i}"),
                order: i,
                source_start_ms: i as i64,
                source_end_ms: i as i64 + 1,
                ..p.ranges[0].clone()
            })
            .collect();
        p.source_media.duration_ms = 10_000;
        let edl = generate_edit_decision_list(&p).unwrap();
        assert_eq!(edl.entries.len(), 10_000);
        assert!(
            edl.entries
                .windows(2)
                .all(|w| w[0].output_end_ms == w[1].output_start_ms)
        );
    }
}

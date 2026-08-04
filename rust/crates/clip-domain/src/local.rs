use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const LOCAL_CLIP_SCHEMA_VERSION: u8 = 1;
pub const MAX_LOCAL_CLIP_COUNT: usize = 12;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalClipEditorStateV1 {
    pub scenes: Value,
    pub current_scene_id: String,
    pub settings: Value,
    pub timeline_view_state: Option<Value>,
    #[serde(default)]
    pub capinsta_caption_documents: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalClipItemV1 {
    pub schema_version: u8,
    pub id: String,
    pub ordinal: usize,
    pub title: String,
    pub source_start_ms: i64,
    pub source_end_ms: i64,
    pub selected_for_export: bool,
    pub captions_enabled: bool,
    pub heading_enabled: bool,
    pub caption_status: String,
    pub export_status: String,
    pub editor_project_state: LocalClipEditorStateV1,
    pub created_at: String,
    pub updated_at: String,
}

impl LocalClipItemV1 {
    pub fn duration_ms(&self) -> i64 {
        self.source_end_ms - self.source_start_ms
    }

    pub fn validate(
        &self,
        source_duration_ms: i64,
        maximum_duration_ms: i64,
    ) -> Result<(), &'static str> {
        if self.schema_version != LOCAL_CLIP_SCHEMA_VERSION {
            return Err("invalid_schema_version");
        }
        validate_range(
            self.source_start_ms,
            self.source_end_ms,
            source_duration_ms,
            maximum_duration_ms,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalClipPlatformPresetV1 {
    InstagramReels,
    YoutubeShorts,
    Tiktok,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalClipBatchV1 {
    pub schema_version: u8,
    pub id: String,
    pub title: String,
    pub source_media_id: String,
    pub source_file_name: String,
    pub source_duration_ms: i64,
    pub source_mime_type: String,
    pub platform_preset: LocalClipPlatformPresetV1,
    pub aspect_ratio: Value,
    pub captions_enabled: bool,
    pub headings_enabled: bool,
    pub maximum_clip_duration_ms: i64,
    pub clip_order: Vec<String>,
    pub selected_clip_id: Option<String>,
    pub normal_editor_project_state: LocalClipEditorStateV1,
    pub items: Vec<LocalClipItemV1>,
    pub created_at: String,
    pub updated_at: String,
}

impl LocalClipBatchV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != LOCAL_CLIP_SCHEMA_VERSION
            || self.source_media_id.is_empty()
            || self.source_duration_ms <= 0
            || self.maximum_clip_duration_ms <= 0
            || self.maximum_clip_duration_ms > super::MAX_MANUAL_CLIP_DURATION_MS
            || self.items.len() > MAX_LOCAL_CLIP_COUNT
        {
            return Err("invalid_batch");
        }
        let ids: HashSet<_> = self.items.iter().map(|item| item.id.as_str()).collect();
        if ids.len() != self.items.len()
            || self.clip_order.len() != self.items.len()
            || self.clip_order.iter().any(|id| !ids.contains(id.as_str()))
            || self
                .selected_clip_id
                .as_ref()
                .is_some_and(|id| !ids.contains(id.as_str()))
        {
            return Err("invalid_clip_order");
        }
        self.items.iter().try_for_each(|item| {
            item.validate(self.source_duration_ms, self.maximum_clip_duration_ms)
        })
    }
}

pub fn validate_range(
    start_ms: i64,
    end_ms: i64,
    source_duration_ms: i64,
    maximum_duration_ms: i64,
) -> Result<(), &'static str> {
    if start_ms < 0 || end_ms <= start_ms {
        return Err("invalid_range_duration");
    }
    if end_ms > source_duration_ms {
        return Err("range_exceeds_media");
    }
    if maximum_duration_ms <= 0
        || maximum_duration_ms > super::MAX_MANUAL_CLIP_DURATION_MS
        || end_ms - start_ms > maximum_duration_ms
    {
        return Err("range_exceeds_maximum_duration");
    }
    Ok(())
}

pub fn initial_ranges(
    source_duration_ms: i64,
    count: usize,
    maximum_duration_ms: i64,
) -> Result<Vec<(i64, i64)>, &'static str> {
    if source_duration_ms <= 0
        || count == 0
        || count > MAX_LOCAL_CLIP_COUNT
        || source_duration_ms < count as i64
    {
        return Err("invalid_clip_count");
    }
    if maximum_duration_ms <= 0 || maximum_duration_ms > super::MAX_MANUAL_CLIP_DURATION_MS {
        return Err("range_exceeds_maximum_duration");
    }
    let slot = source_duration_ms as f64 / count as f64;
    let duration = (slot.floor() as i64).clamp(1, maximum_duration_ms);
    Ok((0..count)
        .map(|index| {
            let start = (index as f64 * slot).floor() as i64;
            (start, (start + duration).min(source_duration_ms))
        })
        .collect())
}

pub fn adjust_range(
    start_ms: i64,
    end_ms: i64,
    mode: &str,
    delta_ms: i64,
    source_duration_ms: i64,
    maximum_duration_ms: i64,
) -> Result<(i64, i64), &'static str> {
    validate_range(start_ms, end_ms, source_duration_ms, maximum_duration_ms)?;
    let duration = end_ms - start_ms;
    match mode {
        "body" => {
            let start = (start_ms + delta_ms).clamp(0, source_duration_ms - duration);
            Ok((start, start + duration))
        }
        "start" => Ok((
            (start_ms + delta_ms).clamp((end_ms - maximum_duration_ms).max(0), end_ms - 1),
            end_ms,
        )),
        "end" => Ok((
            start_ms,
            (end_ms + delta_ms).clamp(
                start_ms + 1,
                (start_ms + maximum_duration_ms).min(source_duration_ms),
            ),
        )),
        _ => Err("invalid_adjustment_mode"),
    }
}

pub fn source_to_clip_time(
    source_time_ms: i64,
    start_ms: i64,
    end_ms: i64,
) -> Result<i64, &'static str> {
    if source_time_ms < start_ms || source_time_ms > end_ms {
        return Err("time_outside_clip");
    }
    Ok(source_time_ms - start_ms)
}

pub fn clip_to_source_time(
    clip_time_ms: i64,
    start_ms: i64,
    end_ms: i64,
) -> Result<i64, &'static str> {
    if clip_time_ms < 0 || clip_time_ms > end_ms - start_ms {
        return Err("time_outside_clip");
    }
    Ok(start_ms + clip_time_ms)
}

pub fn sanitize_clip_filename(title: &str) -> String {
    let value: String = title
        .chars()
        .map(|character| match character {
            '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*' | ' ' | '\0'..='\u{1f}' => '-',
            _ => character,
        })
        .collect();
    let value = value
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let value = value.trim_matches([' ', '.', '-']);
    let value = if value.is_empty() { "clip" } else { value };
    value.chars().take(80).collect()
}

pub fn format_timecode(milliseconds: i64) -> String {
    let milliseconds = milliseconds.max(0);
    let total_seconds = milliseconds / 1_000;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;
    let millis = milliseconds % 1_000;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
    } else {
        format!("{minutes:02}:{seconds:02}.{millis:03}")
    }
}

pub fn parse_timecode(value: &str) -> Result<i64, &'static str> {
    let (clock, millis) = value.trim().split_once('.').ok_or("invalid_timecode")?;
    if millis.len() != 3 || !millis.chars().all(|character| character.is_ascii_digit()) {
        return Err("invalid_timecode");
    }
    let fields = clock
        .split(':')
        .map(|field| field.parse::<i64>().map_err(|_| "invalid_timecode"))
        .collect::<Result<Vec<_>, _>>()?;
    let (hours, minutes, seconds) = match fields.as_slice() {
        [minutes, seconds] => (0, *minutes, *seconds),
        [hours, minutes, seconds] if *minutes < 60 => (*hours, *minutes, *seconds),
        _ => return Err("invalid_timecode"),
    };
    if hours < 0 || minutes < 0 || seconds < 0 || seconds >= 60 {
        return Err("invalid_timecode");
    }
    hours
        .checked_mul(3_600_000)
        .and_then(|value| value.checked_add(minutes * 60_000))
        .and_then(|value| value.checked_add(seconds * 1_000))
        .and_then(|value| value.checked_add(millis.parse::<i64>().ok()?))
        .ok_or("invalid_timecode")
}

pub fn default_heading_layout(
    canvas_width: i64,
    canvas_height: i64,
    character_count: usize,
) -> Result<(i64, i64), &'static str> {
    if canvas_width <= 0 || canvas_height <= 0 || character_count == 0 {
        return Err("invalid_heading_layout");
    }
    let fit = (canvas_width as f64 * 0.85 / (character_count as f64 * 0.6)).floor() as i64;
    let font_size = fit.clamp(18, 72);
    let position_y = -(canvas_height as f64 * 0.28).round() as i64;
    Ok((font_size, position_y))
}

pub fn safe_zip_entry(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['/', '\\'])
        && !name.contains("..")
        && !name.contains(['/', '\\', '\0'])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_deterministic_bounded_and_may_overlap() {
        let ranges = initial_ranges(1_800_000, 5, 180_000).unwrap();
        assert_eq!(
            ranges,
            vec![
                (0, 180_000),
                (360_000, 540_000),
                (720_000, 900_000),
                (1_080_000, 1_260_000),
                (1_440_000, 1_620_000)
            ]
        );
        assert!(validate_range(10_000, 20_000, 30_000, 180_000).is_ok());
        assert!(validate_range(15_000, 25_000, 30_000, 180_000).is_ok());
        assert!(validate_range(0, 0, 30_000, 180_000).is_err());
        assert!(validate_range(-1, 1, 30_000, 180_000).is_err());
        assert!(validate_range(0, 180_001, 300_000, 180_000).is_err());
        assert!(validate_range(20_000, 30_001, 30_000, 180_000).is_err());
    }

    #[test]
    fn adjustments_and_time_mapping_preserve_the_source_contract() {
        assert_eq!(
            adjust_range(10_000, 20_000, "start", 1_000, 30_000, 180_000).unwrap(),
            (11_000, 20_000)
        );
        assert_eq!(
            adjust_range(10_000, 20_000, "end", -1_000, 30_000, 180_000).unwrap(),
            (10_000, 19_000)
        );
        assert_eq!(
            adjust_range(10_000, 20_000, "body", 50_000, 30_000, 180_000).unwrap(),
            (20_000, 30_000)
        );
        assert_eq!(source_to_clip_time(12_000, 10_000, 20_000).unwrap(), 2_000);
        assert_eq!(clip_to_source_time(2_000, 10_000, 20_000).unwrap(), 12_000);
    }

    #[test]
    fn filenames_cannot_escape_a_zip() {
        assert_eq!(sanitize_clip_filename("../bad\\name"), "bad-name");
        assert!(safe_zip_entry("clip-01-safe.mp4"));
        assert!(!safe_zip_entry("../escape.mp4"));
        assert!(!safe_zip_entry("folder/escape.mp4"));
    }

    #[test]
    fn clip_timecodes_round_trip_without_raw_milliseconds() {
        assert_eq!(format_timecode(64_518), "01:04.518");
        assert_eq!(format_timecode(3_664_518), "01:01:04.518");
        assert_eq!(parse_timecode("01:04.518"), Ok(64_518));
        assert_eq!(parse_timecode("01:01:04.518"), Ok(3_664_518));
        assert!(parse_timecode("1:99.000").is_err());
        assert!(parse_timecode("64518").is_err());
    }

    #[test]
    fn default_heading_is_bounded_across_common_aspect_ratios() {
        for (width, height) in [
            (1080, 1920),
            (1080, 1080),
            (1080, 1350),
            (1920, 1080),
            (320, 180),
        ] {
            let (font_size, position_y) = default_heading_layout(width, height, 13).unwrap();
            assert!((18..=72).contains(&font_size));
            assert!(font_size as f64 * 13.0 * 0.6 <= width as f64 * 0.85 + 1.0);
            assert!(position_y.abs() + font_size < height / 2);
        }
    }
}

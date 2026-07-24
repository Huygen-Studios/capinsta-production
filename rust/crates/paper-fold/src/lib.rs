use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingInput {
    pub local_time_seconds: f64,
    pub duration_seconds: f64,
    pub timeline_fps: f64,
    pub frame_count: u32,
    pub mode: String,
    pub progress: f64,
    pub in_duration: f64,
    pub out_duration: f64,
    pub hold_duration: f64,
    pub reverse: bool,
    pub frame_hold: u32,
    pub posterize_fps: f64,
    pub animation_offset: f64,
    pub random_seed: u32,
    pub shake_amount: f64,
    pub shake_frequency: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameState {
    pub progress: f64,
    pub frame_index: u32,
    pub offset_x: f64,
    pub offset_y: f64,
    pub rotation_degrees: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInput {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub frames: Vec<ManifestFrameInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFrameInput {
    pub paper: String,
    pub matte: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestValidation {
    pub valid: bool,
    pub errors: Vec<String>,
}

pub fn resolve_frame_state(input: &TimingInput) -> FrameState {
    let duration = finite_non_negative(input.duration_seconds);
    let fps = positive_or(input.timeline_fps, 30.0);
    let posterize_fps = if input.posterize_fps > 0.0 {
        input.posterize_fps.min(fps)
    } else {
        fps
    };
    let raw_time = finite_or(input.local_time_seconds + input.animation_offset, 0.0);
    let posterized_time = (raw_time * posterize_fps).floor() / posterize_fps;
    let held_time = if input.frame_hold > 1 {
        let frame = (posterized_time * fps).floor();
        (frame / input.frame_hold as f64).floor() * input.frame_hold as f64 / fps
    } else {
        posterized_time
    };
    let t = held_time.clamp(0.0, duration);

    let mut progress = match input.mode.as_str() {
        "manual" => clamp01(input.progress),
        "fold-out" => fold_out_progress(t, duration, input.out_duration),
        "fold-in-out" => fold_in_out_progress(
            t,
            duration,
            input.in_duration,
            input.out_duration,
            input.hold_duration,
        ),
        _ => fold_in_progress(t, input.in_duration),
    };
    if input.reverse {
        progress = 1.0 - progress;
    }

    let frame_count = input.frame_count.max(1);
    let frame_index = ((frame_count - 1) as f64 * progress)
        .round()
        .clamp(0.0, (frame_count - 1) as f64) as u32;
    let shake_frame = (t * positive_or(input.shake_frequency, fps)).floor() as i64;
    let shake = finite_non_negative(input.shake_amount);
    let offset_x = signed_random(input.random_seed, shake_frame, 0) * shake;
    let offset_y = signed_random(input.random_seed, shake_frame, 1) * shake;
    let rotation_degrees = signed_random(input.random_seed, shake_frame, 2) * shake * 0.12;

    FrameState {
        progress,
        frame_index,
        offset_x,
        offset_y,
        rotation_degrees,
    }
}

pub fn validate_manifest(input: &ManifestInput, max_texture_size: u32) -> ManifestValidation {
    let mut errors = Vec::new();
    if input.id.trim().is_empty() {
        errors.push("Style id is required".to_string());
    }
    if input.width == 0 || input.height == 0 {
        errors.push("Style dimensions must be positive".to_string());
    }
    if input.frame_count == 0 {
        errors.push("Style must contain at least one frame".to_string());
    }
    if input.frames.len() != input.frame_count as usize {
        errors.push("Frame count does not match the manifest".to_string());
    }
    for (index, frame) in input.frames.iter().enumerate() {
        if frame.paper.trim().is_empty() {
            errors.push(format!("Frame {index} is missing its paper asset"));
        }
        if frame.matte.trim().is_empty() {
            errors.push(format!("Frame {index} is missing its matte asset"));
        }
    }
    let columns = (input.frame_count.max(1) as f64).sqrt().ceil() as u32;
    let rows = input.frame_count.max(1).div_ceil(columns);
    let atlas_width = input.width.saturating_mul(columns).saturating_mul(2);
    let atlas_height = input.height.saturating_mul(rows);
    if max_texture_size > 0 && (atlas_width > max_texture_size || atlas_height > max_texture_size) {
        errors.push(format!(
            "Packed atlas {atlas_width}x{atlas_height} exceeds the {max_texture_size}px texture limit"
        ));
    }
    ManifestValidation {
        valid: errors.is_empty(),
        errors,
    }
}

fn fold_in_progress(time: f64, duration: f64) -> f64 {
    let duration = finite_non_negative(duration);
    if duration <= f64::EPSILON {
        return 1.0;
    }
    smoothstep(clamp01(time / duration))
}

fn fold_out_progress(time: f64, clip_duration: f64, out_duration: f64) -> f64 {
    let out_duration = finite_non_negative(out_duration);
    if out_duration <= f64::EPSILON {
        return if time >= clip_duration { 0.0 } else { 1.0 };
    }
    let start = (clip_duration - out_duration).max(0.0);
    1.0 - smoothstep(clamp01((time - start) / out_duration))
}

fn fold_in_out_progress(
    time: f64,
    clip_duration: f64,
    in_duration: f64,
    out_duration: f64,
    hold_duration: f64,
) -> f64 {
    if clip_duration <= f64::EPSILON {
        return 0.0;
    }
    let mut in_duration = finite_non_negative(in_duration);
    let mut out_duration = finite_non_negative(out_duration);
    let requested_hold = finite_non_negative(hold_duration);
    let available_for_transitions = (clip_duration - requested_hold).max(0.0);
    let transition_total = in_duration + out_duration;
    if transition_total > available_for_transitions && transition_total > f64::EPSILON {
        let scale = available_for_transitions / transition_total;
        in_duration *= scale;
        out_duration *= scale;
    }
    let out_start = (clip_duration - out_duration).max(in_duration);
    if time < in_duration {
        fold_in_progress(time, in_duration)
    } else if time < out_start {
        1.0
    } else {
        fold_out_progress(time, clip_duration, out_duration)
    }
}

fn smoothstep(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}

fn clamp01(value: f64) -> f64 {
    finite_or(value, 0.0).clamp(0.0, 1.0)
}

fn finite_non_negative(value: f64) -> f64 {
    finite_or(value, 0.0).max(0.0)
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() { value } else { fallback }
}

fn positive_or(value: f64, fallback: f64) -> f64 {
    let value = finite_or(value, fallback);
    if value > 0.0 { value } else { fallback }
}

fn signed_random(seed: u32, frame: i64, channel: u32) -> f64 {
    let mut value = seed
        .wrapping_add((frame as u32).wrapping_mul(0x9e37_79b9))
        .wrapping_add(channel.wrapping_mul(0x85eb_ca6b));
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^= value >> 16;
    (value as f64 / u32::MAX as f64) * 2.0 - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(mode: &str) -> TimingInput {
        TimingInput {
            local_time_seconds: 0.0,
            duration_seconds: 4.0,
            timeline_fps: 30.0,
            frame_count: 9,
            mode: mode.to_string(),
            progress: 0.25,
            in_duration: 1.0,
            out_duration: 1.0,
            hold_duration: 1.0,
            reverse: false,
            frame_hold: 1,
            posterize_fps: 0.0,
            animation_offset: 0.0,
            random_seed: 42,
            shake_amount: 8.0,
            shake_frequency: 12.0,
        }
    }

    #[test]
    fn fold_in_timing() {
        let mut value = input("fold-in");
        assert_eq!(resolve_frame_state(&value).progress, 0.0);
        value.local_time_seconds = 0.5;
        assert_eq!(resolve_frame_state(&value).progress, 0.5);
        value.local_time_seconds = 2.0;
        assert_eq!(resolve_frame_state(&value).progress, 1.0);
    }

    #[test]
    fn fold_out_timing() {
        let mut value = input("fold-out");
        value.local_time_seconds = 2.0;
        assert_eq!(resolve_frame_state(&value).progress, 1.0);
        value.local_time_seconds = 3.5;
        assert_eq!(resolve_frame_state(&value).progress, 0.5);
        value.local_time_seconds = 4.0;
        assert_eq!(resolve_frame_state(&value).progress, 0.0);
    }

    #[test]
    fn fold_in_out_timing_and_short_clip_scaling() {
        let mut value = input("fold-in-out");
        value.local_time_seconds = 2.0;
        assert_eq!(resolve_frame_state(&value).progress, 1.0);
        value.duration_seconds = 1.0;
        value.local_time_seconds = 0.25;
        assert_eq!(resolve_frame_state(&value).progress, 1.0);
    }

    #[test]
    fn manual_reverse_and_frame_selection() {
        let mut value = input("manual");
        assert_eq!(resolve_frame_state(&value).frame_index, 2);
        value.reverse = true;
        let state = resolve_frame_state(&value);
        assert_eq!(state.progress, 0.75);
        assert_eq!(state.frame_index, 6);
    }

    #[test]
    fn frame_hold_and_posterization_are_stable() {
        let mut value = input("fold-in");
        value.local_time_seconds = 0.11;
        value.posterize_fps = 10.0;
        value.frame_hold = 3;
        let first = resolve_frame_state(&value);
        value.local_time_seconds = 0.19;
        let second = resolve_frame_state(&value);
        assert_eq!(first.frame_index, second.frame_index);
    }

    #[test]
    fn shake_is_seeded_and_scrub_direction_independent() {
        let mut value = input("fold-in");
        value.local_time_seconds = 0.75;
        let first = resolve_frame_state(&value);
        let second = resolve_frame_state(&value);
        assert_eq!(first, second);
        value.random_seed = 43;
        assert_ne!(first.offset_x, resolve_frame_state(&value).offset_x);
    }

    #[test]
    fn negative_offset_and_zero_duration_are_safe() {
        let mut value = input("fold-in");
        value.duration_seconds = 0.0;
        value.animation_offset = -10.0;
        let state = resolve_frame_state(&value);
        assert!(state.progress.is_finite());
        assert!(state.frame_index < value.frame_count);
    }

    #[test]
    fn validates_manifest_and_atlas_limits() {
        let valid = ManifestInput {
            id: "center-fold".into(),
            width: 256,
            height: 256,
            frame_count: 2,
            frames: vec![
                ManifestFrameInput {
                    paper: "a".into(),
                    matte: "b".into(),
                },
                ManifestFrameInput {
                    paper: "c".into(),
                    matte: "d".into(),
                },
            ],
        };
        assert!(validate_manifest(&valid, 4096).valid);
        assert!(!validate_manifest(&valid, 256).valid);
    }
}

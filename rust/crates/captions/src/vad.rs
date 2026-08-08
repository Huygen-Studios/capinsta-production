use crate::{MICROSECONDS_PER_SECOND, VadRegion, VadRegionKind};

#[derive(Clone, Debug, PartialEq)]
pub struct VadConfig {
    pub frame_ms: u32,
    pub hop_ms: u32,
    pub min_speech_ms: u32,
    pub min_silence_ms: u32,
    pub speech_padding_ms: u32,
    pub threshold_above_noise_db: f32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            frame_ms: 30,
            hop_ms: 10,
            min_speech_ms: 100,
            min_silence_ms: 150,
            speech_padding_ms: 30,
            threshold_above_noise_db: 10.0,
        }
    }
}

fn percentile(values: &mut [f32], fraction: f32) -> f32 {
    if values.is_empty() {
        return -96.0;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let index = ((values.len() - 1) as f32 * fraction.clamp(0.0, 1.0)).round() as usize;
    values[index]
}

fn sample_to_us(sample: usize, sample_rate: u32) -> i64 {
    ((sample as i128 * MICROSECONDS_PER_SECOND as i128) / sample_rate.max(1) as i128) as i64
}

/// Deterministic waveform-energy VAD.
///
/// The threshold is relative to the measured 20th-percentile noise floor and
/// uses hysteresis. It supplements provider word gaps; it is not a speech
/// recognizer and never changes transcript text.
pub fn detect_voice_activity(
    pcm: &[i16],
    sample_rate: u32,
    timeline_offset_us: i64,
    config: &VadConfig,
) -> Vec<VadRegion> {
    if pcm.is_empty() || sample_rate == 0 {
        return Vec::new();
    }
    let frame = ((sample_rate as u64 * config.frame_ms as u64) / 1_000).max(1) as usize;
    let hop = ((sample_rate as u64 * config.hop_ms as u64) / 1_000).max(1) as usize;
    let mut energies = Vec::new();
    let mut starts = Vec::new();
    let mut offset = 0;
    while offset < pcm.len() {
        let end = (offset + frame).min(pcm.len());
        let mean_square = pcm[offset..end]
            .iter()
            .map(|sample| {
                let normalized = f64::from(*sample) / 32768.0;
                normalized * normalized
            })
            .sum::<f64>()
            / (end - offset).max(1) as f64;
        energies.push((10.0 * (mean_square.max(1e-12)).log10()) as f32);
        starts.push(offset);
        offset = offset.saturating_add(hop);
    }
    let mut noise_samples = energies.clone();
    let noise_floor = percentile(&mut noise_samples, 0.20);
    let enter_threshold = (noise_floor + config.threshold_above_noise_db).clamp(-55.0, -18.0);
    let leave_threshold = enter_threshold - 4.0;
    let mut speech_flags = Vec::with_capacity(energies.len());
    let mut in_speech = false;
    for energy in energies {
        if in_speech {
            if energy < leave_threshold {
                in_speech = false;
            }
        } else if energy >= enter_threshold {
            in_speech = true;
        }
        speech_flags.push(in_speech);
    }

    let min_speech_frames = (config.min_speech_ms / config.hop_ms.max(1)).max(1) as usize;
    let min_silence_frames = (config.min_silence_ms / config.hop_ms.max(1)).max(1) as usize;
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut cursor = 0;
    while cursor < speech_flags.len() {
        if !speech_flags[cursor] {
            cursor += 1;
            continue;
        }
        let start = cursor;
        while cursor < speech_flags.len() && speech_flags[cursor] {
            cursor += 1;
        }
        if cursor - start >= min_speech_frames {
            ranges.push((start, cursor));
        }
    }

    // Merge short internal dropouts so consonants do not fragment speech.
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for range in ranges {
        if let Some(previous) = merged.last_mut()
            && range.0.saturating_sub(previous.1) < min_silence_frames
        {
            previous.1 = range.1;
            continue;
        }
        merged.push(range);
    }

    let padding_samples = ((sample_rate as u64 * config.speech_padding_ms as u64) / 1_000) as usize;
    let duration_us = sample_to_us(pcm.len(), sample_rate);
    let mut speech = Vec::new();
    for (index, (start_frame, end_frame)) in merged.into_iter().enumerate() {
        let start_sample = starts[start_frame].saturating_sub(padding_samples);
        let end_frame_start = starts.get(end_frame).copied().unwrap_or(pcm.len());
        let end_sample = (end_frame_start + frame + padding_samples).min(pcm.len());
        let start_us = sample_to_us(start_sample, sample_rate) + timeline_offset_us;
        let end_us = sample_to_us(end_sample, sample_rate) + timeline_offset_us;
        if end_us > start_us {
            speech.push(VadRegion {
                id: format!("vad-speech-{}", index + 1),
                kind: VadRegionKind::Speech,
                start_us,
                end_us,
                confidence: None,
            });
        }
    }

    let absolute_start = timeline_offset_us;
    let absolute_end = timeline_offset_us + duration_us;
    let mut result = Vec::new();
    let mut previous_end = absolute_start;
    let mut silence_index = 0;
    for region in speech {
        if region.start_us > previous_end {
            silence_index += 1;
            result.push(VadRegion {
                id: format!("vad-silence-{}", silence_index),
                kind: VadRegionKind::Silence,
                start_us: previous_end,
                end_us: region.start_us,
                confidence: None,
            });
        }
        previous_end = previous_end.max(region.end_us);
        result.push(region);
    }
    if previous_end < absolute_end {
        silence_index += 1;
        result.push(VadRegion {
            id: format!("vad-silence-{}", silence_index),
            kind: VadRegionKind::Silence,
            start_us: previous_end,
            end_us: absolute_end,
            confidence: None,
        });
    }
    result.sort_by_key(|region| (region.start_us, region.end_us));
    result
}

pub fn vad_has_verified_silence(regions: &[VadRegion], gap_start_us: i64, gap_end_us: i64) -> bool {
    let gap_duration = gap_end_us.saturating_sub(gap_start_us);
    if gap_duration <= 0 {
        return false;
    }
    regions.iter().any(|region| {
        if region.kind != VadRegionKind::Silence {
            return false;
        }
        let overlap_start = region.start_us.max(gap_start_us);
        let overlap_end = region.end_us.min(gap_end_us);
        overlap_end.saturating_sub(overlap_start) * 2 >= gap_duration
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(samples: usize, amplitude: i16) -> Vec<i16> {
        (0..samples)
            .map(|index| {
                if index % 20 < 10 {
                    amplitude
                } else {
                    -amplitude
                }
            })
            .collect()
    }

    #[test]
    fn finds_leading_and_internal_silence() {
        let rate = 16_000;
        let mut pcm = vec![0; rate / 2];
        pcm.extend(tone(rate / 2, 9_000));
        pcm.extend(vec![0; rate]);
        pcm.extend(tone(rate / 2, 9_000));
        let regions = detect_voice_activity(&pcm, rate as u32, 1_000_000, &VadConfig::default());
        assert!(regions.iter().any(|region| {
            region.kind == VadRegionKind::Silence
                && region.start_us <= 1_100_000
                && region.end_us >= 1_400_000
        }));
        assert!(
            regions
                .iter()
                .filter(|r| r.kind == VadRegionKind::Speech)
                .count()
                >= 2
        );
    }
}

use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAudio {
    pub sample_rate: u32,
    pub samples: Vec<i16>,
    pub duration_us: i64,
    pub source_channels: usize,
    pub downmix_strategy: String,
    pub wav_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AudioDecodeError {
    UnsupportedContainer,
    UnsupportedEncoding(String),
    Malformed(String),
    DurationMismatch { expected_us: i64, decoded_us: i64 },
}

impl fmt::Display for AudioDecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedContainer => write!(formatter, "unsupported audio container"),
            Self::UnsupportedEncoding(encoding) => {
                write!(formatter, "unsupported audio encoding: {encoding}")
            }
            Self::Malformed(message) => write!(formatter, "malformed audio: {message}"),
            Self::DurationMismatch {
                expected_us,
                decoded_us,
            } => write!(
                formatter,
                "decoded duration {decoded_us}us does not match expected duration {expected_us}us"
            ),
        }
    }
}

impl std::error::Error for AudioDecodeError {}

fn u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn u16_be(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_extended_80(bytes: &[u8], offset: usize) -> Option<f64> {
    let first = *bytes.get(offset)?;
    let exponent = (((first & 0x7f) as u16) << 8) | *bytes.get(offset + 1)? as u16;
    let sign = if first & 0x80 != 0 { -1.0 } else { 1.0 };
    let high = u32_be(bytes, offset + 2)? as u64;
    let low = u32_be(bytes, offset + 6)? as u64;
    let mantissa = (high << 32) | low;
    if exponent == 0 && mantissa == 0 {
        return Some(0.0);
    }
    Some(sign * mantissa as f64 * 2_f64.powi(exponent as i32 - 16_383 - 63))
}

fn decode_integer(bytes: &[u8], offset: usize, bits: u16, little_endian: bool) -> Option<f32> {
    match bits {
        8 => Some(i8::from_ne_bytes([*bytes.get(offset)?]) as f32 / 128.0),
        16 => {
            let raw: [u8; 2] = bytes.get(offset..offset + 2)?.try_into().ok()?;
            let value = if little_endian {
                i16::from_le_bytes(raw)
            } else {
                i16::from_be_bytes(raw)
            };
            Some(value as f32 / 32_768.0)
        }
        24 => {
            let slice = bytes.get(offset..offset + 3)?;
            let unsigned = if little_endian {
                slice[0] as i32 | (slice[1] as i32) << 8 | (slice[2] as i32) << 16
            } else {
                (slice[0] as i32) << 16 | (slice[1] as i32) << 8 | slice[2] as i32
            };
            let signed = if unsigned & 0x80_0000 != 0 {
                unsigned - 0x100_0000
            } else {
                unsigned
            };
            Some(signed as f32 / 8_388_608.0)
        }
        32 => {
            let raw: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
            let value = if little_endian {
                i32::from_le_bytes(raw)
            } else {
                i32::from_be_bytes(raw)
            };
            Some(value as f32 / 2_147_483_648.0)
        }
        _ => None,
    }
}

pub fn decode_pcm_audio(bytes: &[u8]) -> Result<DecodedAudio, AudioDecodeError> {
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        decode_wav(bytes)
    } else if bytes.starts_with(b"FORM")
        && matches!(bytes.get(8..12), Some(b"AIFF") | Some(b"AIFC"))
    {
        decode_aiff(bytes)
    } else {
        Err(AudioDecodeError::UnsupportedContainer)
    }
}

fn decode_wav(bytes: &[u8]) -> Result<DecodedAudio, AudioDecodeError> {
    let mut cursor = 12;
    let mut format = None;
    let mut channels = 0_u16;
    let mut sample_rate = 0_u32;
    let mut bits = 0_u16;
    let mut data = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32_le(bytes, cursor + 4)
            .ok_or_else(|| AudioDecodeError::Malformed("truncated WAV chunk size".to_owned()))?
            as usize;
        let body = cursor + 8;
        let end = body.saturating_add(size).min(bytes.len());
        if id == b"fmt " && size >= 16 {
            let mut encoding = u16_le(bytes, body).unwrap_or(0);
            channels = u16_le(bytes, body + 2).unwrap_or(0);
            sample_rate = u32_le(bytes, body + 4).unwrap_or(0);
            bits = u16_le(bytes, body + 14).unwrap_or(0);
            if encoding == 0xfffe && size >= 26 {
                encoding = u16_le(bytes, body + 24).unwrap_or(0);
            }
            format = Some(encoding);
        } else if id == b"data" {
            data = Some((body, end));
        }
        cursor = body.saturating_add(size).saturating_add(size & 1);
    }
    let encoding =
        format.ok_or_else(|| AudioDecodeError::Malformed("missing fmt chunk".to_owned()))?;
    if channels == 0 || sample_rate == 0 {
        return Err(AudioDecodeError::Malformed("invalid WAV format".to_owned()));
    }
    let (data_start, data_end) =
        data.ok_or_else(|| AudioDecodeError::Malformed("missing data chunk".to_owned()))?;
    let bytes_per_sample = usize::from(bits.div_ceil(8));
    let frame_bytes = bytes_per_sample * usize::from(channels);
    if bytes_per_sample == 0 || frame_bytes == 0 {
        return Err(AudioDecodeError::Malformed(
            "invalid sample size".to_owned(),
        ));
    }
    let frames = (data_end - data_start) / frame_bytes;
    let mut output = vec![Vec::with_capacity(frames); usize::from(channels)];
    for frame_index in 0..frames {
        let base = data_start + frame_index * frame_bytes;
        for (channel, channel_output) in output.iter_mut().enumerate() {
            let offset = base + channel * bytes_per_sample;
            let value = match encoding {
                1 if bits == 8 => (*bytes.get(offset).unwrap_or(&128) as f32 - 128.0) / 128.0,
                1 => decode_integer(bytes, offset, bits, true).ok_or_else(|| {
                    AudioDecodeError::UnsupportedEncoding(format!("WAV PCM {bits}-bit"))
                })?,
                3 if bits == 32 => f32::from_le_bytes(
                    bytes[offset..offset + 4]
                        .try_into()
                        .map_err(|_| AudioDecodeError::Malformed("truncated float".to_owned()))?,
                ),
                3 if bits == 64 => f64::from_le_bytes(
                    bytes[offset..offset + 8]
                        .try_into()
                        .map_err(|_| AudioDecodeError::Malformed("truncated float".to_owned()))?,
                ) as f32,
                _ => {
                    return Err(AudioDecodeError::UnsupportedEncoding(format!(
                        "WAV format {encoding}, {bits}-bit"
                    )));
                }
            };
            channel_output.push(value.clamp(-1.0, 1.0));
        }
    }
    Ok(DecodedAudio {
        sample_rate,
        channels: output,
    })
}

fn decode_aiff(bytes: &[u8]) -> Result<DecodedAudio, AudioDecodeError> {
    let is_aifc = bytes.get(8..12) == Some(b"AIFC");
    let mut cursor = 12;
    let mut channels = 0_u16;
    let mut bits = 0_u16;
    let mut sample_rate = 0_u32;
    let mut compression = *b"NONE";
    let mut sound_data = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32_be(bytes, cursor + 4).unwrap_or(0) as usize;
        let body = cursor + 8;
        if id == b"COMM" && size >= 18 {
            channels = u16_be(bytes, body).unwrap_or(0);
            bits = u16_be(bytes, body + 6).unwrap_or(0);
            sample_rate = read_extended_80(bytes, body + 8)
                .filter(|rate| rate.is_finite() && *rate > 0.0)
                .map(|rate| rate.round() as u32)
                .unwrap_or(0);
            if is_aifc && size >= 22 {
                compression.copy_from_slice(bytes.get(body + 18..body + 22).unwrap_or(b"NONE"));
            }
        } else if id == b"SSND" && size >= 8 {
            let data_offset = u32_be(bytes, body).unwrap_or(0) as usize;
            let start = body.saturating_add(8).saturating_add(data_offset);
            let end = body.saturating_add(size).min(bytes.len());
            sound_data = Some((start.min(end), end));
        }
        cursor = body.saturating_add(size).saturating_add(size & 1);
    }
    if channels == 0 || sample_rate == 0 {
        return Err(AudioDecodeError::Malformed(
            "missing AIFF COMM data".to_owned(),
        ));
    }
    let (data_start, data_end) = sound_data
        .ok_or_else(|| AudioDecodeError::Malformed("missing AIFF SSND data".to_owned()))?;
    let little_endian = &compression == b"sowt";
    let float = matches!(&compression, b"fl32" | b"FL32" | b"fl64" | b"FL64");
    if !float
        && !matches!(
            &compression,
            b"NONE" | b"twos" | b"sowt" | b"in16" | b"in24" | b"in32" | b"raw "
        )
    {
        return Err(AudioDecodeError::UnsupportedEncoding(
            String::from_utf8_lossy(&compression).into_owned(),
        ));
    }
    let bytes_per_sample = usize::from(bits.div_ceil(8));
    let frame_bytes = bytes_per_sample * usize::from(channels);
    let frames = (data_end - data_start) / frame_bytes.max(1);
    let mut output = vec![Vec::with_capacity(frames); usize::from(channels)];
    for frame_index in 0..frames {
        let base = data_start + frame_index * frame_bytes;
        for (channel, channel_output) in output.iter_mut().enumerate() {
            let offset = base + channel * bytes_per_sample;
            let value = if float && bits == 32 {
                let raw: [u8; 4] = bytes[offset..offset + 4]
                    .try_into()
                    .map_err(|_| AudioDecodeError::Malformed("truncated AIFF float".to_owned()))?;
                f32::from_be_bytes(raw)
            } else if float && bits == 64 {
                let raw: [u8; 8] = bytes[offset..offset + 8]
                    .try_into()
                    .map_err(|_| AudioDecodeError::Malformed("truncated AIFF float".to_owned()))?;
                f64::from_be_bytes(raw) as f32
            } else {
                decode_integer(bytes, offset, bits, little_endian).ok_or_else(|| {
                    AudioDecodeError::UnsupportedEncoding(format!("AIFF PCM {bits}-bit"))
                })?
            };
            channel_output.push(value.clamp(-1.0, 1.0));
        }
    }
    Ok(DecodedAudio {
        sample_rate,
        channels: output,
    })
}

fn rms(channel: &[f32]) -> f64 {
    if channel.is_empty() {
        return 0.0;
    }
    (channel
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>()
        / channel.len() as f64)
        .sqrt()
}

fn correlation(left: &[f32], right: &[f32]) -> f64 {
    let length = left.len().min(right.len());
    if length == 0 {
        return 1.0;
    }
    let dot = left[..length]
        .iter()
        .zip(&right[..length])
        .map(|(left, right)| f64::from(*left) * f64::from(*right))
        .sum::<f64>();
    let norm = rms(&left[..length]) * rms(&right[..length]) * length as f64;
    if norm <= 1e-12 {
        1.0
    } else {
        (dot / norm).clamp(-1.0, 1.0)
    }
}

fn safe_downmix(channels: &[Vec<f32>]) -> (Vec<f32>, &'static str) {
    if channels.len() <= 1 {
        return (channels.first().cloned().unwrap_or_default(), "mono");
    }
    let length = channels.iter().map(Vec::len).min().unwrap_or(0);
    let phase_inverted = (0..channels.len()).any(|left| {
        (left + 1..channels.len())
            .any(|right| correlation(&channels[left][..length], &channels[right][..length]) < -0.5)
    });
    if phase_inverted {
        let channel = channels
            .iter()
            .max_by(|left, right| rms(left).total_cmp(&rms(right)))
            .cloned()
            .unwrap_or_default();
        return (channel, "highest_energy_channel_phase_safe");
    }
    let mut mono = vec![0.0_f32; length];
    let scale = 1.0 / channels.len() as f32;
    for channel in channels {
        for (target, sample) in mono.iter_mut().zip(channel) {
            *target += *sample * scale;
        }
    }
    (mono, "equal_power_average")
}

fn resample_linear(input: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if source_rate == target_rate || input.is_empty() {
        return input.to_vec();
    }
    let output_length = ((input.len() as u128 * target_rate as u128 + source_rate as u128 / 2)
        / source_rate as u128) as usize;
    let mut output = Vec::with_capacity(output_length);
    for index in 0..output_length {
        let source_position = index as f64 * source_rate as f64 / target_rate as f64;
        let left = source_position.floor() as usize;
        let fraction = (source_position - left as f64) as f32;
        let a = input[left.min(input.len() - 1)];
        let b = input[(left + 1).min(input.len() - 1)];
        output.push(a + (b - a) * fraction);
    }
    output
}

fn encode_wav_16k(samples: &[i16]) -> Vec<u8> {
    let data_len = samples.len().saturating_mul(2).min(u32::MAX as usize) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36_u32.saturating_add(data_len)).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&16_000_u32.to_le_bytes());
    bytes.extend_from_slice(&32_000_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

pub fn normalize_transcription_audio(
    decoded: DecodedAudio,
    expected_duration_us: Option<i64>,
) -> Result<NormalizedAudio, AudioDecodeError> {
    if decoded.sample_rate == 0 || decoded.channels.is_empty() {
        return Err(AudioDecodeError::Malformed(
            "empty decoded audio".to_owned(),
        ));
    }
    let source_channels = decoded.channels.len();
    let (mono, strategy) = safe_downmix(&decoded.channels);
    let resampled = resample_linear(&mono, decoded.sample_rate, 16_000);
    let samples: Vec<i16> = resampled
        .into_iter()
        .map(|sample| {
            let scaled = (sample.clamp(-1.0, 1.0) * 32_767.0).round();
            scaled.clamp(i16::MIN as f32, i16::MAX as f32) as i16
        })
        .collect();
    let duration_us = ((samples.len() as i128 * 1_000_000_i128) / 16_000_i128) as i64;
    if let Some(expected) = expected_duration_us {
        let tolerance = 100_000_i64.max(expected.abs() / 100);
        if (expected - duration_us).abs() > tolerance {
            return Err(AudioDecodeError::DurationMismatch {
                expected_us: expected,
                decoded_us: duration_us,
            });
        }
    }
    Ok(NormalizedAudio {
        sample_rate: 16_000,
        wav_bytes: encode_wav_16k(&samples),
        samples,
        duration_us,
        source_channels,
        downmix_strategy: strategy.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_inverted_stereo_does_not_cancel() {
        let left: Vec<f32> = (0..16_000)
            .map(|index| if index % 20 < 10 { 0.5 } else { -0.5 })
            .collect();
        let right: Vec<f32> = left.iter().map(|sample| -*sample).collect();
        let normalized = normalize_transcription_audio(
            DecodedAudio {
                sample_rate: 16_000,
                channels: vec![left, right],
            },
            Some(1_000_000),
        )
        .unwrap();
        assert_eq!(
            normalized.downmix_strategy,
            "highest_energy_channel_phase_safe"
        );
        assert!(
            normalized
                .samples
                .iter()
                .any(|sample| sample.abs() > 10_000)
        );
    }

    fn aiff_extended_44_1k() -> [u8; 10] {
        [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]
    }

    #[test]
    fn decodes_aifc_sowt_little_endian() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&54_u32.to_be_bytes());
        bytes.extend_from_slice(b"AIFC");
        bytes.extend_from_slice(b"COMM");
        bytes.extend_from_slice(&22_u32.to_be_bytes());
        bytes.extend_from_slice(&2_u16.to_be_bytes());
        bytes.extend_from_slice(&2_u32.to_be_bytes());
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(&aiff_extended_44_1k());
        bytes.extend_from_slice(b"sowt");
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&16_u32.to_be_bytes());
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        for sample in [1_000_i16, -1_000, 2_000, -2_000] {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let decoded = decode_pcm_audio(&bytes).unwrap();
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.channels.len(), 2);
        assert!((decoded.channels[0][0] - 1_000.0 / 32_768.0).abs() < 1e-6);
        assert!((decoded.channels[1][0] + 1_000.0 / 32_768.0).abs() < 1e-6);
    }
}

//! Provider-neutral TranscriptDocumentV2. All persisted time values are milliseconds.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milliseconds(pub i64);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub name: String,
    pub model: Option<String>,
    pub request_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub original_text: Option<String>,
    pub speaker_id: Option<String>,
    pub language: Option<String>,
    pub confidence: Option<f64>,
    #[serde(default)]
    pub word_ids: Vec<String>,
    pub timing_source: TimingSource,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub id: String,
    pub segment_id: String,
    pub text: String,
    pub original_text: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub confidence: Option<f64>,
    pub speaker_id: Option<String>,
    pub language: Option<String>,
    pub timing_source: TimingSource,
    #[serde(default)]
    pub is_filler: bool,
    #[serde(default)]
    pub is_low_confidence: bool,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub id: String,
    pub label: String,
    pub display_name: Option<String>,
    pub confidence: Option<f64>,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceRegion {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: Option<f64>,
    pub source: String,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingSource {
    #[serde(rename = "provider")]
    Provider,
    #[serde(rename = "aligned")]
    Aligned,
    #[serde(rename = "interpolated")]
    Interpolated,
    #[serde(rename = "estimated")]
    Estimated,
    #[serde(rename = "manuallyAdjusted")]
    ManuallyAdjusted,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    pub overall_score: Option<f64>,
    pub timing_score: Option<f64>,
    pub confidence_score: Option<f64>,
    #[serde(default)]
    pub low_confidence_word_count: u64,
    #[serde(default)]
    pub untimed_word_count: u64,
    #[serde(default)]
    pub overlap_count: u64,
    #[serde(default)]
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDocumentV2 {
    pub schema_version: u8,
    pub transcript_id: String,
    pub media_id: String,
    pub duration_ms: i64,
    pub language_mode: String,
    #[serde(default)]
    pub detected_languages: Vec<String>,
    pub provider: Provider,
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub words: Vec<Word>,
    #[serde(default)]
    pub speakers: Vec<Speaker>,
    #[serde(default)]
    pub silence_regions: Vec<SilenceRegion>,
    #[serde(default)]
    pub quality: Quality,
    #[serde(default)]
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

impl TranscriptDocumentV2 {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 2 {
            return Err("schemaVersion must equal 2".into());
        }
        if self.duration_ms < 0 {
            return Err("durationMs must be non-negative".into());
        }
        let segment_ids: std::collections::HashSet<_> =
            self.segments.iter().map(|x| &x.id).collect();
        if segment_ids.len() != self.segments.len() {
            return Err("duplicate segment id".into());
        }
        let word_ids: std::collections::HashSet<_> = self.words.iter().map(|x| &x.id).collect();
        if word_ids.len() != self.words.len() {
            return Err("duplicate word id".into());
        }
        let speaker_ids: std::collections::HashSet<_> =
            self.speakers.iter().map(|x| &x.id).collect();
        if speaker_ids.len() != self.speakers.len() {
            return Err("duplicate speaker id".into());
        }
        let silence_ids: std::collections::HashSet<_> =
            self.silence_regions.iter().map(|x| &x.id).collect();
        if silence_ids.len() != self.silence_regions.len() {
            return Err("duplicate silence region id".into());
        }
        let confidence = |v: Option<f64>| v.map(|n| n >= 0.0 && n <= 1.0).unwrap_or(true);
        for s in &self.segments {
            if s.start_ms < 0 || s.end_ms < s.start_ms || s.end_ms > self.duration_ms {
                return Err("invalid segment timestamp".into());
            };
            if !confidence(s.confidence) {
                return Err("invalid confidence".into());
            };
            if s.speaker_id
                .as_ref()
                .is_some_and(|id| !speaker_ids.contains(id))
            {
                return Err("unknown speaker".into());
            };
            let refs: std::collections::HashSet<_> = s.word_ids.iter().collect();
            if refs.len() != s.word_ids.len() || s.word_ids.iter().any(|id| !word_ids.contains(id))
            {
                return Err("invalid segment word reference".into());
            }
        }
        for w in &self.words {
            if !segment_ids.contains(&w.segment_id) {
                return Err("unknown word segment".into());
            };
            if w.start_ms.is_some() != w.end_ms.is_some()
                || matches!((w.start_ms,w.end_ms),(Some(a),Some(b)) if a<0||b<a||b>self.duration_ms)
            {
                return Err("invalid word timestamp".into());
            };
            if !confidence(w.confidence) {
                return Err("invalid confidence".into());
            };
            if w.speaker_id
                .as_ref()
                .is_some_and(|id| !speaker_ids.contains(id))
            {
                return Err("unknown speaker".into());
            }
        }
        for s in &self.silence_regions {
            if s.start_ms < 0
                || s.end_ms < s.start_ms
                || s.end_ms > self.duration_ms
                || !confidence(s.confidence)
            {
                return Err("invalid silence region".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixtures_validate() {
        for f in [
            "english-words.json",
            "hinglish.json",
            "telgish-manual.json",
            "multiple-speakers-overlap.json",
            "empty.json",
            "low-confidence.json",
        ] {
            let raw = std::fs::read_to_string(format!(
                "../../../contracts/fixtures/transcript-document-v2/{f}"
            ))
            .unwrap();
            let doc: TranscriptDocumentV2 = serde_json::from_str(&raw).unwrap();
            doc.validate().unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&serde_json::to_string(&doc).unwrap())
                    .unwrap(),
                serde_json::from_str::<serde_json::Value>(&raw).unwrap()
            );
        }
    }
    #[test]
    fn invalid_fixture_rejects() {
        let raw = std::fs::read_to_string(
            "../../../contracts/fixtures/transcript-document-v2/invalid-negative.json",
        )
        .unwrap();
        assert!(
            serde_json::from_str::<TranscriptDocumentV2>(&raw).is_err()
                || serde_json::from_str::<TranscriptDocumentV2>(&raw)
                    .unwrap()
                    .validate()
                    .is_err()
        )
    }
}

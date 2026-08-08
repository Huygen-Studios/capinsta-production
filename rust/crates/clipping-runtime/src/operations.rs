use clip_domain::{
    ClipProjectV1, TranscriptMappingOptions, generate_edit_decision_list, map_transcript_to_output,
    validate_against_transcript,
};
use project_bridge::{ClipProjectConversionInputV1, convert_clip_project_to_capinsta};
use serde::Deserialize;
use serde_json::{Value, json};
use shorts_domain::{
    CandidateAnalysisInputV1, ReframePlanningInputV1, ShortCompositionInputV1, analyze_candidates,
    compose_short, plan_reframe,
};
use transcript_domain::TranscriptDocumentV2;

use crate::limits::{
    MAX_METADATA_BYTES, MAX_RANGES, MAX_TRANSCRIPT_SEGMENTS, MAX_TRANSCRIPT_WORDS,
};
use crate::protocol::{ClippingRuntimeRequestV1, ClippingRuntimeResponseV1, PROTOCOL_VERSION};

const OPERATIONS: [&str; 7] = [
    "analyze_candidates",
    "compose_short",
    "convert_project",
    "derive_project",
    "health",
    "plan_reframe",
    "version",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeriveOptions {
    #[serde(default = "yes")]
    include_remapped_transcript: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DerivePayload {
    clip_project: ClipProjectV1,
    transcript: TranscriptDocumentV2,
    #[serde(default)]
    options: DeriveOptions,
}

impl Default for DeriveOptions {
    fn default() -> Self {
        Self {
            include_remapped_transcript: true,
        }
    }
}

fn metadata_size(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
}

fn invalid(
    request_id: String,
    code: &str,
    message: &str,
    path: Option<&str>,
) -> ClippingRuntimeResponseV1 {
    ClippingRuntimeResponseV1::failure(request_id, code, message, path)
}

fn derive(request_id: String, payload: Value) -> ClippingRuntimeResponseV1 {
    let value: DerivePayload = match serde_json::from_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return invalid(
                request_id,
                "invalid_clip_project",
                "The derivation payload is invalid.",
                Some("payload"),
            );
        }
    };
    if value.clip_project.ranges.len() > MAX_RANGES
        || value.transcript.words.len() > MAX_TRANSCRIPT_WORDS
        || value.transcript.segments.len() > MAX_TRANSCRIPT_SEGMENTS
    {
        return invalid(
            request_id,
            "input_too_large",
            "The derivation contract exceeds a collection limit.",
            Some("payload"),
        );
    }
    if metadata_size(&value.clip_project.metadata) > MAX_METADATA_BYTES
        || metadata_size(&value.transcript.metadata) > MAX_METADATA_BYTES
    {
        return invalid(
            request_id,
            "input_too_large",
            "Contract metadata exceeds the runtime limit.",
            Some("payload"),
        );
    }
    if value.clip_project.validate().is_err() {
        return invalid(
            request_id,
            "invalid_clip_project",
            "The clip project contract is invalid.",
            Some("payload.clipProject"),
        );
    }
    if value.transcript.validate().is_err() {
        return invalid(
            request_id,
            "invalid_transcript",
            "The transcript contract is invalid.",
            Some("payload.transcript"),
        );
    }
    if value.clip_project.transcript_id.as_deref() != Some(&value.transcript.transcript_id)
        || value.clip_project.source_media.media_id != value.transcript.media_id
        || value.clip_project.source_media.duration_ms != value.transcript.duration_ms
        || !validate_against_transcript(&value.clip_project, Some(&value.transcript)).is_empty()
    {
        return invalid(
            request_id,
            "clip_project_transcript_mismatch",
            "The clip project and transcript dependencies do not match.",
            Some("payload.transcript"),
        );
    }
    let edl = match generate_edit_decision_list(&value.clip_project) {
        Ok(value) => value,
        Err(issues) => {
            let code = if issues
                .iter()
                .any(|issue| issue.category == "arithmetic_overflow")
            {
                "arithmetic_overflow"
            } else {
                "edl_generation_failed"
            };
            return invalid(
                request_id,
                code,
                "Rust could not generate an edit decision list.",
                Some("payload.clipProject"),
            );
        }
    };
    let remapped = if value.options.include_remapped_transcript {
        match map_transcript_to_output(
            &value.transcript,
            &edl,
            &TranscriptMappingOptions::default(),
        ) {
            Ok(value) => Some(value),
            Err(_) => {
                return invalid(
                    request_id,
                    "transcript_remapping_failed",
                    "Rust could not remap the transcript.",
                    Some("payload.transcript"),
                );
            }
        }
    } else {
        None
    };
    let warnings = edl
        .warnings
        .iter()
        .map(|warning| warning.category.clone())
        .chain(
            remapped
                .iter()
                .flat_map(|document| document.warnings.iter())
                .map(|warning| warning.category.clone()),
        )
        .collect();
    ClippingRuntimeResponseV1::success(
        request_id,
        json!({
            "editDecisionList": edl,
            "remappedTranscript": remapped,
            "summary": {
                "projectId": value.clip_project.clip_project_id,
                "projectRevision": value.clip_project.revision,
                "entryCount": edl.entries.len(),
                "outputDurationMs": edl.output_duration_ms,
                "remappedWordCount": remapped.as_ref().map_or(0, |item| item.words.len()),
                "remappedSegmentCount": remapped.as_ref().map_or(0, |item| item.segments.len())
            }
        }),
        warnings,
    )
}

fn convert(request_id: String, payload: Value) -> ClippingRuntimeResponseV1 {
    let value: ClipProjectConversionInputV1 = match serde_json::from_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return invalid(
                request_id,
                "invalid_conversion_input",
                "The conversion input contract is invalid.",
                Some("payload"),
            );
        }
    };
    if value.clip_project.ranges.len() > MAX_RANGES
        || metadata_size(&value.metadata) > MAX_METADATA_BYTES
    {
        return invalid(
            request_id,
            "input_too_large",
            "The conversion contract exceeds a runtime limit.",
            Some("payload"),
        );
    }
    match convert_clip_project_to_capinsta(&value) {
        Ok(result) => {
            let warnings = result
                .warnings
                .iter()
                .map(|warning| warning.category.clone())
                .collect();
            ClippingRuntimeResponseV1::success(request_id, json!(result), warnings)
        }
        Err(_) => invalid(
            request_id,
            "conversion_failed",
            "Rust could not convert the clipping project.",
            Some("payload"),
        ),
    }
}

fn analyze_candidate_payload(request_id: String, payload: Value) -> ClippingRuntimeResponseV1 {
    let value: CandidateAnalysisInputV1 = match serde_json::from_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return invalid(
                request_id,
                "invalid_candidate_input",
                "The candidate-analysis payload is invalid.",
                Some("payload"),
            );
        }
    };
    match analyze_candidates(value) {
        Ok(result) => ClippingRuntimeResponseV1::success(request_id, json!(result), vec![]),
        Err(code) => invalid(
            request_id,
            code,
            "Rust could not normalize candidate proposals.",
            Some("payload"),
        ),
    }
}

fn plan_reframe_payload(request_id: String, payload: Value) -> ClippingRuntimeResponseV1 {
    let value: ReframePlanningInputV1 = match serde_json::from_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return invalid(
                request_id,
                "invalid_reframe_input",
                "The reframe payload is invalid.",
                Some("payload"),
            );
        }
    };
    match plan_reframe(value) {
        Ok(result) => ClippingRuntimeResponseV1::success(request_id, json!(result), vec![]),
        Err(code) => invalid(
            request_id,
            code,
            "Rust could not produce a reframe plan.",
            Some("payload"),
        ),
    }
}

fn compose_short_payload(request_id: String, payload: Value) -> ClippingRuntimeResponseV1 {
    let value: ShortCompositionInputV1 = match serde_json::from_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return invalid(
                request_id,
                "invalid_composition_input",
                "The short-composition payload is invalid.",
                Some("payload"),
            );
        }
    };
    match compose_short(value) {
        Ok(result) => ClippingRuntimeResponseV1::success(request_id, json!(result), vec![]),
        Err(code) => invalid(
            request_id,
            code,
            "Rust could not compose the short project.",
            Some("payload"),
        ),
    }
}

pub fn dispatch(request: ClippingRuntimeRequestV1) -> ClippingRuntimeResponseV1 {
    if request.protocol_version != PROTOCOL_VERSION {
        return invalid(
            request.request_id,
            "unsupported_protocol_version",
            "The runtime protocol version is unsupported.",
            Some("protocolVersion"),
        );
    }
    if request.request_id.is_empty() || request.request_id.len() > 200 {
        return invalid(
            request.request_id,
            "invalid_protocol",
            "The request ID is invalid.",
            Some("requestId"),
        );
    }
    match request.operation.as_str() {
        "health" => ClippingRuntimeResponseV1::success(
            request.request_id,
            json!({"status": "healthy", "linkedEngines": ["clip-domain", "project-bridge"]}),
            vec![],
        ),
        "version" => ClippingRuntimeResponseV1::success(
            request.request_id,
            json!({
                "runtimeVersion": env!("CARGO_PKG_VERSION"),
                "protocolVersions": [PROTOCOL_VERSION],
                "operations": OPERATIONS
            }),
            vec![],
        ),
        "derive_project" => derive(request.request_id, request.payload),
        "convert_project" => convert(request.request_id, request.payload),
        "analyze_candidates" => analyze_candidate_payload(request.request_id, request.payload),
        "plan_reframe" => plan_reframe_payload(request.request_id, request.payload),
        "compose_short" => compose_short_payload(request.request_id, request.payload),
        _ => invalid(
            request.request_id,
            "unknown_operation",
            "The runtime operation is unsupported.",
            Some("operation"),
        ),
    }
}

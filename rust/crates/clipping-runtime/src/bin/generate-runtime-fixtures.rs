use clipping_runtime::{
    operations::dispatch,
    protocol::{ClippingRuntimeRequestV1, ClippingRuntimeResponseV1},
};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn write(path: &str, value: &impl serde::Serialize) {
    let target = repository_root().join(path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, serde_json::to_string_pretty(value).unwrap() + "\n").unwrap();
}

fn request(id: &str, operation: &str, payload: Value) -> ClippingRuntimeRequestV1 {
    serde_json::from_value(json!({
        "protocolVersion": 1,
        "requestId": id,
        "operation": operation,
        "payload": payload,
        "options": {}
    }))
    .unwrap()
}

fn pair(name: &str, value: ClippingRuntimeRequestV1) {
    let response: ClippingRuntimeResponseV1 = dispatch(value.clone());
    write(
        &format!("contracts/fixtures/clipping-runtime-v1/requests/{name}.json"),
        &value_to_json(value),
    );
    write(
        &format!("contracts/fixtures/clipping-runtime-v1/responses/{name}.json"),
        &response,
    );
}

fn value_to_json(value: ClippingRuntimeRequestV1) -> Value {
    serde_json::to_value(json!({
        "protocolVersion": value.protocol_version,
        "requestId": value.request_id,
        "operation": value.operation,
        "payload": value.payload,
        "options": value.options
    }))
    .unwrap()
}

fn main() {
    pair("health", request("req_health", "health", json!({})));
    pair("version", request("req_version", "version", json!({})));

    let mut project: Value = serde_json::from_str(
        &fs::read_to_string(
            repository_root().join("contracts/fixtures/clip-project-v1/one-range.json"),
        )
        .unwrap(),
    )
    .unwrap();
    project["sourceMedia"]["mediaId"] = json!("media_english");
    project["sourceMedia"]["durationMs"] = json!(3000);
    project["ranges"][0]["sourceMediaId"] = json!("media_english");
    project["ranges"][0]["sourceStartMs"] = json!(0);
    project["ranges"][0]["sourceEndMs"] = json!(2000);
    let transcript: Value = serde_json::from_str(
        &fs::read_to_string(
            repository_root().join("contracts/fixtures/transcript-document-v2/english-words.json"),
        )
        .unwrap(),
    )
    .unwrap();
    pair(
        "derive-one-range",
        request(
            "req_derive_one",
            "derive_project",
            json!({
                "clipProject": project,
                "transcript": transcript,
                "options": {"includeRemappedTranscript": true}
            }),
        ),
    );

    let conversion: Value = serde_json::from_str(
        &fs::read_to_string(
            repository_root()
                .join("contracts/fixtures/capinsta-project-conversion-v1/valid/one-range-1x.json"),
        )
        .unwrap(),
    )
    .unwrap();
    pair(
        "convert-without-captions",
        request(
            "req_convert_no_captions",
            "convert_project",
            conversion["input"].clone(),
        ),
    );

    let mut invalid = request("req_invalid_protocol", "health", json!({}));
    invalid.protocol_version = 9;
    let invalid_response = dispatch(invalid.clone());
    write(
        "contracts/fixtures/clipping-runtime-v1/invalid/invalid-protocol-request.json",
        &value_to_json(invalid),
    );
    write(
        "contracts/fixtures/clipping-runtime-v1/invalid/invalid-protocol-response.json",
        &invalid_response,
    );
}

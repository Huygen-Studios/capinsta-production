use std::io::{self, Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};

use clipping_runtime::{
    limits, operations,
    protocol::{ClippingRuntimeRequestV1, ClippingRuntimeResponseV1},
};

fn response_from_stdin() -> (ClippingRuntimeResponseV1, bool) {
    let mut bytes = Vec::new();
    let mut reader = io::stdin().lock().take(limits::MAX_STDIN_BYTES + 1);
    if reader.read_to_end(&mut bytes).is_err() {
        return (
            ClippingRuntimeResponseV1::failure(
                "unknown".into(),
                "invalid_protocol",
                "The runtime request could not be read.",
                None,
            ),
            false,
        );
    }
    if bytes.len() as u64 > limits::MAX_STDIN_BYTES {
        return (
            ClippingRuntimeResponseV1::failure(
                "unknown".into(),
                "input_too_large",
                "The runtime request exceeds the input limit.",
                None,
            ),
            false,
        );
    }
    let request: ClippingRuntimeRequestV1 = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            return (
                ClippingRuntimeResponseV1::failure(
                    "unknown".into(),
                    "invalid_json",
                    "The runtime request is not valid JSON.",
                    None,
                ),
                false,
            );
        }
    };
    let response = match catch_unwind(AssertUnwindSafe(|| operations::dispatch(request))) {
        Ok(value) => value,
        Err(_) => {
            eprintln!("clipping_runtime_failure code=internal_runtime_error");
            ClippingRuntimeResponseV1::failure(
                "unknown".into(),
                "internal_runtime_error",
                "The runtime encountered an internal error.",
                None,
            )
        }
    };
    let ok = response.ok;
    (response, ok)
}

fn main() {
    let (mut response, mut ok) = response_from_stdin();
    let mut output = serde_json::to_vec(&response).unwrap_or_default();
    if output.len() > limits::MAX_STDOUT_BYTES {
        response = ClippingRuntimeResponseV1::failure(
            response.request_id,
            "output_too_large",
            "The runtime result exceeds the output limit.",
            None,
        );
        output = serde_json::to_vec(&response).unwrap_or_default();
        ok = false;
    }
    output.push(b'\n');
    if io::stdout().lock().write_all(&output).is_err() {
        std::process::exit(2);
    }
    if !ok {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(operation: &str, payload: serde_json::Value) -> ClippingRuntimeRequestV1 {
        serde_json::from_value(json!({
            "protocolVersion": 1,
            "requestId": "req_test",
            "operation": operation,
            "payload": payload,
            "options": {}
        }))
        .unwrap()
    }

    #[test]
    fn health_and_version_are_stable() {
        let health = operations::dispatch(request("health", json!({})));
        assert!(health.ok);
        assert_eq!(health.request_id, "req_test");
        let first =
            serde_json::to_string(&operations::dispatch(request("version", json!({})))).unwrap();
        let second =
            serde_json::to_string(&operations::dispatch(request("version", json!({})))).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn protocol_failures_are_structured() {
        let mut value = request("missing", json!({}));
        assert_eq!(
            operations::dispatch(value.clone()).error.unwrap().code,
            "unknown_operation"
        );
        value.protocol_version = 9;
        assert_eq!(
            operations::dispatch(value).error.unwrap().code,
            "unsupported_protocol_version"
        );
    }

    #[test]
    fn derivation_and_conversion_fixtures_are_deterministic() {
        let repository_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        for name in ["derive-one-range", "convert-without-captions"] {
            let raw = std::fs::read_to_string(repository_root.join(format!(
                "contracts/fixtures/clipping-runtime-v1/requests/{name}.json"
            )))
            .unwrap();
            let first = operations::dispatch(serde_json::from_str(&raw).unwrap());
            let second = operations::dispatch(serde_json::from_str(&raw).unwrap());
            assert!(first.ok);
            assert_eq!(
                serde_json::to_string(&first).unwrap(),
                serde_json::to_string(&second).unwrap()
            );
        }
    }
}

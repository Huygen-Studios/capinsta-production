use std::io::Write;
use std::process::{Command, Output, Stdio};

fn invoke(input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_capinsta-clipping-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn process_emits_one_json_response_and_echoes_request_id() {
    let output = invoke(
        br#"{"protocolVersion":1,"requestId":"req_process","operation":"health","payload":{},"options":{}}"#,
    );
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(
        output.stdout.iter().filter(|byte| **byte == b'\n').count(),
        1
    );
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["requestId"], "req_process");
    assert_eq!(response["ok"], true);
}

#[test]
fn invalid_json_is_structured_and_stdout_remains_json_only() {
    let output = invoke(b"{not-json");
    assert!(!output.status.success());
    assert!(output.stderr.is_empty());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["error"]["code"], "invalid_json");
}

#[test]
fn oversized_input_is_rejected_without_unbounded_reading() {
    let input = vec![b' '; clipping_runtime::limits::MAX_STDIN_BYTES as usize + 1];
    let output = invoke(&input);
    assert!(!output.status.success());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["error"]["code"], "input_too_large");
}

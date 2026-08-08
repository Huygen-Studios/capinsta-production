use serde_json::{Value, json};
use std::{
    env,
    io::{self, Read},
    thread,
    time::Duration,
};

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap();
    let request: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
    let request_id = request["requestId"].as_str().unwrap_or("unknown");
    match env::var("CLIPPING_RUNTIME_FAKE_MODE").as_deref() {
        Ok("sleep") => thread::sleep(Duration::from_secs(30)),
        Ok("invalid") => {
            print!("not-json");
            return;
        }
        Ok("multiple") => {
            print!("{{}}\n{{}}\n");
            return;
        }
        Ok("mismatch") => {
            print!(
                "{}",
                json!({"protocolVersion":1,"requestId":"wrong","ok":true,"result":{},"warnings":[],"error":null})
            );
            return;
        }
        Ok("oversized") => {
            print!("{}", "x".repeat(1024 * 1024));
            return;
        }
        Ok("stderr") => eprint!("{}", "x".repeat(1024 * 1024)),
        _ => {}
    }
    print!(
        "{}",
        json!({
            "protocolVersion": 1,
            "requestId": request_id,
            "ok": true,
            "result": {"status":"healthy","linkedEngines":["clip-domain","project-bridge"]},
            "warnings": [],
            "error": null
        })
    );
}

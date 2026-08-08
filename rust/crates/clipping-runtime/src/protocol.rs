use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClippingRuntimeRequestV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub operation: String,
    pub payload: Value,
    #[serde(default)]
    pub options: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeErrorV1 {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClippingRuntimeResponseV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub warnings: Vec<String>,
    pub error: Option<RuntimeErrorV1>,
}

impl ClippingRuntimeResponseV1 {
    pub fn success(request_id: String, result: Value, mut warnings: Vec<String>) -> Self {
        warnings.sort();
        warnings.dedup();
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            warnings,
            error: None,
        }
    }

    pub fn failure(
        request_id: String,
        code: &str,
        message: &str,
        field_path: Option<&str>,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            warnings: vec![],
            error: Some(RuntimeErrorV1 {
                code: code.into(),
                message: message.into(),
                field_path: field_path.map(str::to_owned),
            }),
        }
    }
}

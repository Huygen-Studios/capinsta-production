use paper_fold::{ManifestInput, TimingInput, resolve_frame_state, validate_manifest};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[wasm_bindgen(js_name = resolvePaperFoldFrameState)]
pub fn resolve_paper_fold_frame_state(value: JsValue) -> Result<JsValue, JsValue> {
    let input: TimingInput = serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("Invalid Paper Fold timing input: {error}")))?;
    serde_wasm_bindgen::to_value(&resolve_frame_state(&input))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = validatePaperFoldManifest)]
pub fn validate_paper_fold_manifest(
    value: JsValue,
    max_texture_size: u32,
) -> Result<JsValue, JsValue> {
    let input: ManifestInput = serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("Invalid Paper Fold manifest: {error}")))?;
    serde_wasm_bindgen::to_value(&validate_manifest(&input, max_texture_size))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

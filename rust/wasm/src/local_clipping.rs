use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Range {
    source_start_ms: i64,
    source_end_ms: i64,
}

fn integer(value: f64) -> Result<i64, JsValue> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < i64::MIN as f64
        || value > i64::MAX as f64
    {
        return Err(JsValue::from_str("expected an integer"));
    }
    Ok(value as i64)
}

fn js_error(error: &'static str) -> JsValue {
    JsValue::from_str(error)
}

#[wasm_bindgen(js_name = initialLocalClipRanges)]
pub fn initial_local_clip_ranges(
    source_duration_ms: f64,
    count: u32,
    maximum_duration_ms: f64,
) -> Result<JsValue, JsValue> {
    let ranges = clip_domain::initial_ranges(
        integer(source_duration_ms)?,
        count as usize,
        integer(maximum_duration_ms)?,
    )
    .map_err(js_error)?
    .into_iter()
    .map(|(source_start_ms, source_end_ms)| Range {
        source_start_ms,
        source_end_ms,
    })
    .collect::<Vec<_>>();
    serde_wasm_bindgen::to_value(&ranges).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = adjustLocalClipRange)]
pub fn adjust_local_clip_range(
    source_start_ms: f64,
    source_end_ms: f64,
    mode: &str,
    delta_ms: f64,
    source_duration_ms: f64,
    maximum_duration_ms: f64,
) -> Result<JsValue, JsValue> {
    let (source_start_ms, source_end_ms) = clip_domain::adjust_range(
        integer(source_start_ms)?,
        integer(source_end_ms)?,
        mode,
        integer(delta_ms)?,
        integer(source_duration_ms)?,
        integer(maximum_duration_ms)?,
    )
    .map_err(js_error)?;
    serde_wasm_bindgen::to_value(&Range {
        source_start_ms,
        source_end_ms,
    })
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = sourceToLocalClipTime)]
pub fn source_to_local_clip_time(
    source_time_ms: f64,
    source_start_ms: f64,
    source_end_ms: f64,
) -> Result<f64, JsValue> {
    clip_domain::source_to_clip_time(
        integer(source_time_ms)?,
        integer(source_start_ms)?,
        integer(source_end_ms)?,
    )
    .map(|value| value as f64)
    .map_err(js_error)
}

#[wasm_bindgen(js_name = localClipToSourceTime)]
pub fn local_clip_to_source_time(
    clip_time_ms: f64,
    source_start_ms: f64,
    source_end_ms: f64,
) -> Result<f64, JsValue> {
    clip_domain::clip_to_source_time(
        integer(clip_time_ms)?,
        integer(source_start_ms)?,
        integer(source_end_ms)?,
    )
    .map(|value| value as f64)
    .map_err(js_error)
}

#[wasm_bindgen(js_name = sanitizeLocalClipFilename)]
pub fn sanitize_local_clip_filename(title: &str) -> String {
    clip_domain::sanitize_clip_filename(title)
}

#[wasm_bindgen(js_name = isSafeLocalClipZipEntry)]
pub fn is_safe_local_clip_zip_entry(name: &str) -> bool {
    clip_domain::safe_zip_entry(name)
}

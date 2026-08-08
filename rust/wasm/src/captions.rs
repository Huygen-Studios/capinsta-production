use ::captions::{
    CaptionDocument, CaptionTimingConfig, CaptionTimingIndex, ProviderTranscript, VadRegion,
    apply_page_text_edit, build_caption_pages, edit_page_timing, export_srt, export_vtt,
    normalize_provider_transcript, validate_and_repair_document,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizeCaptionOptions {
    provider_transcript: ProviderTranscript,
    #[serde(default)]
    vad_regions: Vec<VadRegion>,
    #[serde(default)]
    config: CaptionTimingConfig,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizeCaptionResult {
    document: CaptionDocument,
    requires_forced_alignment: bool,
}

fn from_js<T: for<'de> Deserialize<'de>>(value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = canonicalizeCaptionDocument)]
pub fn canonicalize_caption_document(options: JsValue) -> Result<JsValue, JsValue> {
    let options: CanonicalizeCaptionOptions = from_js(options)?;
    let mut document = normalize_provider_transcript(options.provider_transcript, &options.config);
    document.vad_regions = options.vad_regions;
    let validation = validate_and_repair_document(&mut document, &options.config);
    build_caption_pages(&mut document, &options.config);
    to_js(&CanonicalizeCaptionResult {
        document,
        requires_forced_alignment: validation.requires_forced_alignment,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildCaptionPagesOptions {
    document: CaptionDocument,
    #[serde(default)]
    config: CaptionTimingConfig,
}

#[wasm_bindgen(js_name = rebuildCaptionPages)]
pub fn rebuild_caption_pages(options: JsValue) -> Result<JsValue, JsValue> {
    let options: RebuildCaptionPagesOptions = from_js(options)?;
    let mut document = options.document;
    build_caption_pages(&mut document, &options.config);
    to_js(&document)
}

#[wasm_bindgen(js_name = validateCaptionDocument)]
pub fn validate_caption_document(options: JsValue) -> Result<JsValue, JsValue> {
    let options: RebuildCaptionPagesOptions = from_js(options)?;
    let mut document = options.document;
    let validation = validate_and_repair_document(&mut document, &options.config);
    build_caption_pages(&mut document, &options.config);
    to_js(&CanonicalizeCaptionResult {
        document,
        requires_forced_alignment: validation.requires_forced_alignment,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCaptionStateOptions {
    document: CaptionDocument,
    playback_time_us: i64,
}

#[wasm_bindgen(js_name = activeCaptionState)]
pub fn active_caption_state(options: JsValue) -> Result<JsValue, JsValue> {
    let options: ActiveCaptionStateOptions = from_js(options)?;
    let index = CaptionTimingIndex::new(&options.document);
    to_js(&index.active_state(options.playback_time_us))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCaptionOptions {
    document: CaptionDocument,
}

#[wasm_bindgen(js_name = exportCaptionSrt)]
pub fn export_caption_srt(options: JsValue) -> Result<String, JsValue> {
    let options: ExportCaptionOptions = from_js(options)?;
    Ok(export_srt(&options.document))
}

#[wasm_bindgen(js_name = exportCaptionVtt)]
pub fn export_caption_vtt(options: JsValue) -> Result<String, JsValue> {
    let options: ExportCaptionOptions = from_js(options)?;
    Ok(export_vtt(&options.document))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditCaptionPageTextOptions {
    document: CaptionDocument,
    page_id: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditCaptionPageTextResult {
    document: CaptionDocument,
    requires_forced_alignment: bool,
}

#[wasm_bindgen(js_name = editCaptionPageText)]
pub fn edit_caption_page_text(options: JsValue) -> Result<JsValue, JsValue> {
    let options: EditCaptionPageTextOptions = from_js(options)?;
    let mut document = options.document;
    let outcome = apply_page_text_edit(&mut document, &options.page_id, &options.text);
    to_js(&EditCaptionPageTextResult {
        document,
        requires_forced_alignment: matches!(
            outcome,
            ::captions::TextEditOutcome::RequiresForcedAlignment { .. }
        ),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditCaptionPageTimingOptions {
    document: CaptionDocument,
    page_id: String,
    start_us: i64,
    end_us: i64,
    #[serde(default = "default_timing_edit_tolerance")]
    duration_tolerance_us: i64,
}

fn default_timing_edit_tolerance() -> i64 {
    1_000
}

#[wasm_bindgen(js_name = editCaptionPageTiming)]
pub fn edit_caption_page_timing(options: JsValue) -> Result<JsValue, JsValue> {
    let options: EditCaptionPageTimingOptions = from_js(options)?;
    let mut document = options.document;
    let outcome = edit_page_timing(
        &mut document,
        &options.page_id,
        options.start_us,
        options.end_us,
        options.duration_tolerance_us,
    );
    to_js(&EditCaptionPageTextResult {
        document,
        requires_forced_alignment: matches!(
            outcome,
            ::captions::TimingEditOutcome::RequiresForcedAlignment { .. }
        ),
    })
}

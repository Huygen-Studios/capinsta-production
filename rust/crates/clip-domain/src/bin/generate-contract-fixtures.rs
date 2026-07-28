use clip_domain::*;
use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs, path::Path};
use transcript_domain::TranscriptDocumentV2;

fn range(id: &str, order: u64, start: i64, end: i64, rate: f64, enabled: bool) -> ClipRangeV1 {
    ClipRangeV1 {
        schema_version: 1,
        id: id.into(),
        source_media_id: "media_english".into(),
        source_start_ms: start,
        source_end_ms: end,
        order,
        playback_rate: rate,
        selection: None,
        boundary: Default::default(),
        transition_in: None,
        transition_out: None,
        enabled,
        label: None,
        metadata: Value::Object(Map::new()),
    }
}
fn project(id: &str, ranges: Vec<ClipRangeV1>) -> ClipProjectV1 {
    ClipProjectV1 {
        schema_version: 1,
        clip_project_id: id.into(),
        workspace_id: None,
        name: id.into(),
        source_media: SourceMediaReferenceV1 {
            media_id: "media_english".into(),
            duration_ms: 3000,
            source_type: SourceType::Uploaded,
            display_name: Some("synthetic.mp4".into()),
            mime_type: Some("video/mp4".into()),
            storage_key: None,
            checksum: None,
            metadata: Value::Object(Map::new()),
        },
        transcript_id: Some("tr_english".into()),
        transcript_revision: Some(1),
        ranges,
        canvas: ClipCanvasV1 {
            aspect_ratio: "9:16".into(),
            width: 1080,
            height: 1920,
            background: None,
            safe_area: None,
            metadata: Value::Object(Map::new()),
        },
        caption_track: None,
        settings: Default::default(),
        status: "draft".into(),
        revision: 1,
        metadata: Value::Object(Map::new()),
        created_at: "2026-07-24T12:00:00Z".into(),
        updated_at: "2026-07-24T12:00:00Z".into(),
    }
}
fn write_json(path: &Path, value: &impl Serialize) {
    fs::create_dir_all(path.parent().unwrap())
        .unwrap_or_else(|e| panic!("create {}: {e}", path.display()));
    let bytes = serde_json::to_string_pretty(value).expect("serialize fixture") + "\n";
    fs::write(path, bytes).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
    println!("{}", path.display());
}
fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let edl_dir = root.join("contracts/fixtures/edit-decision-list-v1/valid");
    let cases = [
        ("empty.json", project("clip_empty", vec![])),
        (
            "all-ranges-disabled.json",
            project(
                "clip_disabled",
                vec![range("disabled", 0, 0, 1000, 1.0, false)],
            ),
        ),
        (
            "one-range.json",
            project("clip_one", vec![range("range_001", 0, 0, 1000, 1.0, true)]),
        ),
        (
            "multiple-ranges.json",
            project(
                "clip_multi",
                vec![
                    range("r1", 0, 0, 400, 1.0, true),
                    range("r2", 1, 800, 1200, 1.0, true),
                    range("r3", 2, 1600, 2000, 1.0, true),
                ],
            ),
        ),
        (
            "mixed-playback-rates.json",
            project(
                "clip_mixed",
                vec![
                    range("r075", 0, 0, 300, 0.75, true),
                    range("r1", 1, 300, 600, 1.0, true),
                    range("r125", 2, 600, 900, 1.25, true),
                    range("r2", 3, 900, 1200, 2.0, true),
                ],
            ),
        ),
        (
            "repeated-source-range.json",
            project(
                "clip_repeat",
                vec![
                    range("repeat_a", 0, 0, 1200, 1.0, true),
                    range("repeat_b", 1, 0, 1200, 1.0, true),
                ],
            ),
        ),
        (
            "overlapping-source-ranges.json",
            project(
                "clip_overlap",
                vec![
                    range("overlap_a", 0, 0, 900, 1.0, true),
                    range("overlap_b", 1, 500, 1200, 1.0, true),
                ],
            ),
        ),
        (
            "fractional-cumulative-rounding.json",
            project(
                "clip_fractional",
                vec![
                    range("f1", 0, 0, 1, 1.5, true),
                    range("f2", 1, 1, 2, 1.5, true),
                    range("f3", 2, 2, 3, 1.5, true),
                ],
            ),
        ),
    ];
    for (name, p) in cases {
        write_json(
            &edl_dir.join(name),
            &generate_edit_decision_list(&p).expect("valid fixture project"),
        );
    }

    let transcript_path = root.join("contracts/fixtures/transcript-document-v2/english-words.json");
    let transcript: TranscriptDocumentV2 =
        serde_json::from_str(&fs::read_to_string(transcript_path).expect("read transcript"))
            .expect("parse transcript");
    let remap_dir = root.join("contracts/fixtures/remapped-transcript-v1/valid");
    let base = generate_edit_decision_list(&project(
        "clip_remap",
        vec![range("range_001", 0, 0, 1200, 1.0, true)],
    ))
    .unwrap();
    let mapped =
        map_transcript_to_output(&transcript, &base, &TranscriptMappingOptions::default()).unwrap();
    for name in ["one-word.json", "segment-reconstructed-from-words.json"] {
        write_json(&remap_dir.join(name), &mapped);
    }
    let clipped_edl = generate_edit_decision_list(&project(
        "clip_clipped",
        vec![range("range_clip", 0, 200, 900, 1.0, true)],
    ))
    .unwrap();
    write_json(
        &remap_dir.join("clipped-boundary-word.json"),
        &map_transcript_to_output(
            &transcript,
            &clipped_edl,
            &TranscriptMappingOptions::default(),
        )
        .unwrap(),
    );
    let mut edited = transcript.clone();
    edited.words[0].text = "HELLO EDITED".into();
    edited.segments[0].text = "HELLO EDITED world.".into();
    write_json(
        &remap_dir.join("displayed-text-differs-from-original.json"),
        &map_transcript_to_output(&edited, &base, &TranscriptMappingOptions::default()).unwrap(),
    );
    let repeated = generate_edit_decision_list(&project(
        "clip_repeated",
        vec![
            range("repeat_a", 0, 0, 1200, 1.0, true),
            range("repeat_b", 1, 0, 1200, 1.0, true),
        ],
    ))
    .unwrap();
    write_json(
        &remap_dir.join("repeated-range-occurrences.json"),
        &map_transcript_to_output(&transcript, &repeated, &TranscriptMappingOptions::default())
            .unwrap(),
    );
    let mut untimed = transcript.clone();
    untimed.words[0].start_ms = None;
    untimed.words[0].end_ms = None;
    write_json(
        &remap_dir.join("untimed-word-excluded.json"),
        &map_transcript_to_output(&untimed, &base, &TranscriptMappingOptions::default()).unwrap(),
    );
    write_json(
        &remap_dir.join("untimed-word-preserved.json"),
        &map_transcript_to_output(
            &untimed,
            &base,
            &TranscriptMappingOptions {
                boundary_policy: WordBoundaryPolicy::Clipped,
                untimed_word_policy: UntimedWordPolicy::PreserveUntimed,
            },
        )
        .unwrap(),
    );
    let empty = TranscriptDocumentV2 {
        segments: vec![],
        words: vec![],
        ..transcript
    };
    write_json(
        &remap_dir.join("empty.json"),
        &map_transcript_to_output(&empty, &base, &TranscriptMappingOptions::default()).unwrap(),
    );
}

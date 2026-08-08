use clip_domain::{
    CaptionTrackReferenceV1, ClipProjectV1, ClipRangeV1, DomainWarning, EditDecisionListV1,
    RemappedSegmentOccurrenceV1, RemappedTranscriptV1, RemappedWordOccurrenceV1,
    generate_edit_decision_list,
};
use project_bridge::{
    CAPINSTA_PROJECT_VERSION, ClipProjectConversionInputV1, ClipProjectConversionOptionsV1,
    UnsupportedFeaturePolicy, convert_clip_project_to_capinsta,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{fs, path::Path};
use transcript_domain::TimingSource;

const ROOT: &str = "contracts/fixtures/capinsta-project-conversion-v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidFixture<'a> {
    input: &'a ClipProjectConversionInputV1,
    result: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InvalidFixture<'a> {
    input: &'a ClipProjectConversionInputV1,
    expected_issue_category: &'a str,
}

fn base_project() -> ClipProjectV1 {
    let raw = fs::read_to_string("contracts/fixtures/clip-project-v1/one-range.json").unwrap();
    let mut project: ClipProjectV1 = serde_json::from_str(&raw).unwrap();
    project.metadata = json!({});
    project.source_media.storage_key = Some("portable/media_001".into());
    project.canvas.background = Some("#000000".into());
    project.caption_track = Some(CaptionTrackReferenceV1 {
        caption_track_id: "captions_001".into(),
        transcript_id: project.transcript_id.clone(),
        style_preset_id: Some("word_highlight_box".into()),
        enabled: true,
        metadata: json!({}),
    });
    project
}

fn input(project: ClipProjectV1) -> ClipProjectConversionInputV1 {
    let edit_decision_list = generate_edit_decision_list(&project).unwrap();
    ClipProjectConversionInputV1 {
        schema_version: 1,
        clip_project: project,
        edit_decision_list,
        remapped_transcript: None,
        target_project_id: "project_fixture".into(),
        target_project_version: CAPINSTA_PROJECT_VERSION,
        options: ClipProjectConversionOptionsV1 {
            include_captions: true,
            preserve_disabled_ranges: false,
            create_separate_tracks: false,
            unsupported_feature_policy: UnsupportedFeaturePolicy::Warn,
        },
        metadata: json!({"fixture": true}),
    }
}

fn range(template: &ClipRangeV1, id: &str, order: u64, start: i64, end: i64) -> ClipRangeV1 {
    ClipRangeV1 {
        id: id.into(),
        order,
        source_start_ms: start,
        source_end_ms: end,
        ..template.clone()
    }
}

fn remapped(edl: &EditDecisionListV1, displayed_differs: bool) -> RemappedTranscriptV1 {
    let mut segments = Vec::new();
    let mut words = Vec::new();
    for entry in &edl.entries {
        let word_id = format!("{}__word_001", entry.range_id);
        let segment_id = format!("{}__seg_001", entry.range_id);
        words.push(RemappedWordOccurrenceV1 {
            occurrence_id: word_id.clone(),
            source_word_id: "word_001".into(),
            source_segment_id: "seg_001".into(),
            range_id: entry.range_id.clone(),
            text: if displayed_differs {
                "DISPLAYED".into()
            } else {
                "hello".into()
            },
            original_text: Some("hello".into()),
            original_source_start_ms: Some(entry.source_start_ms),
            original_source_end_ms: Some(entry.source_end_ms),
            effective_source_start_ms: Some(entry.source_start_ms),
            effective_source_end_ms: Some(entry.source_end_ms),
            output_start_ms: Some(entry.output_start_ms),
            output_end_ms: Some(entry.output_end_ms),
            speaker_id: Some("speaker_001".into()),
            language: Some("en".into()),
            confidence: Some(0.93),
            timing_source: TimingSource::Provider,
            is_filler: false,
            is_low_confidence: false,
            metadata: json!({}),
        });
        segments.push(RemappedSegmentOccurrenceV1 {
            occurrence_id: segment_id,
            source_segment_id: "seg_001".into(),
            range_id: entry.range_id.clone(),
            text: if displayed_differs {
                "DISPLAYED".into()
            } else {
                "hello".into()
            },
            original_text: Some("hello".into()),
            original_source_start_ms: Some(entry.source_start_ms),
            original_source_end_ms: Some(entry.source_end_ms),
            effective_source_start_ms: Some(entry.source_start_ms),
            effective_source_end_ms: Some(entry.source_end_ms),
            output_start_ms: Some(entry.output_start_ms),
            output_end_ms: Some(entry.output_end_ms),
            word_occurrence_ids: vec![word_id],
            speaker_id: Some("speaker_001".into()),
            language: Some("en".into()),
            confidence: Some(0.93),
            timing_source: TimingSource::Provider,
            metadata: json!({}),
        });
    }
    RemappedTranscriptV1 {
        schema_version: 1,
        source_transcript_id: "tr_english".into(),
        clip_project_id: edl.clip_project_id.clone(),
        project_revision: edl.project_revision,
        source_media_id: edl.source_media_id.clone(),
        output_duration_ms: edl.output_duration_ms,
        segments,
        words,
        warnings: Vec::<DomainWarning>::new(),
        metadata: json!({}),
    }
}

fn write_json(path: impl AsRef<Path>, value: &impl Serialize) {
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    fs::write(path, bytes).unwrap();
}

fn write_valid(name: &str, value: &ClipProjectConversionInputV1) {
    let result = convert_clip_project_to_capinsta(value).unwrap();
    write_json(
        format!("{ROOT}/valid/{name}.json"),
        &ValidFixture {
            input: value,
            result: serde_json::to_value(result).unwrap(),
        },
    );
}

fn write_invalid(name: &str, value: &ClipProjectConversionInputV1, category: &str) {
    let errors = convert_clip_project_to_capinsta(value).unwrap_err();
    assert!(
        errors.iter().any(|issue| issue.category == category),
        "{name} did not produce {category}: {errors:?}"
    );
    write_json(
        format!("{ROOT}/invalid/{name}.json"),
        &InvalidFixture {
            input: value,
            expected_issue_category: category,
        },
    );
}

fn main() {
    fs::create_dir_all(format!("{ROOT}/valid")).unwrap();
    fs::create_dir_all(format!("{ROOT}/invalid")).unwrap();

    let mut empty_project = base_project();
    empty_project.ranges.clear();
    let empty = input(empty_project);
    write_valid("empty-clip-project", &empty);

    let one = input(base_project());
    write_valid("one-range-1x", &one);

    let template = base_project().ranges[0].clone();
    let mut multiple_project = base_project();
    multiple_project.ranges = vec![
        range(&template, "range_a", 0, 1_000, 2_000),
        range(&template, "range_b", 1, 3_000, 4_000),
        range(&template, "range_c", 2, 5_000, 6_000),
    ];
    let multiple = input(multiple_project.clone());
    write_valid("multiple-ranges", &multiple);

    let mut non_chronological_project = multiple_project.clone();
    non_chronological_project.ranges = vec![
        range(&template, "later_source", 0, 5_000, 6_000),
        range(&template, "earlier_source", 1, 1_000, 2_000),
    ];
    write_valid(
        "non-chronological-source-order",
        &input(non_chronological_project),
    );

    let mut repeated_project = multiple_project.clone();
    repeated_project.ranges = vec![
        range(&template, "repeat_a", 0, 1_000, 2_000),
        range(&template, "repeat_b", 1, 1_000, 2_000),
    ];
    write_valid("repeated-source-range", &input(repeated_project.clone()));

    let mut overlap_project = multiple_project.clone();
    overlap_project.ranges = vec![
        range(&template, "overlap_a", 0, 1_000, 2_500),
        range(&template, "overlap_b", 1, 2_000, 3_000),
    ];
    write_valid("overlapping-source-ranges", &input(overlap_project));

    let mut mixed_project = multiple_project.clone();
    mixed_project.ranges = [0.75, 1.0, 1.25, 2.0]
        .into_iter()
        .enumerate()
        .map(|(index, playback_rate)| ClipRangeV1 {
            playback_rate,
            ..range(
                &template,
                &format!("mixed_{index}"),
                index as u64,
                index as i64 * 300,
                index as i64 * 300 + 300,
            )
        })
        .collect();
    let mixed = input(mixed_project);
    assert_eq!(mixed.edit_decision_list.output_duration_ms, 1_090);
    write_valid("mixed-playback-rates-1090ms", &mixed);

    write_valid("vertical-9x16-canvas", &one);
    let mut custom_project = base_project();
    custom_project.canvas.aspect_ratio = "custom".into();
    custom_project.canvas.width = 1234;
    custom_project.canvas.height = 777;
    write_valid("custom-canvas", &input(custom_project));

    let mut no_captions = one.clone();
    no_captions.options.include_captions = false;
    write_valid("project-without-captions", &no_captions);

    let mut captions = one.clone();
    captions.remapped_transcript = Some(remapped(&captions.edit_decision_list, false));
    write_valid("project-with-remapped-captions", &captions);

    let mut displayed = one.clone();
    displayed.remapped_transcript = Some(remapped(&displayed.edit_decision_list, true));
    write_valid("displayed-caption-differs", &displayed);

    let repeated_input = input(repeated_project);
    let mut repeated_captions = repeated_input.clone();
    repeated_captions.remapped_transcript =
        Some(remapped(&repeated_captions.edit_decision_list, false));
    write_valid("repeated-caption-occurrences", &repeated_captions);

    let mut metadata = one.clone();
    metadata.clip_project.metadata = json!({"source": "synthetic"});
    metadata.edit_decision_list = generate_edit_decision_list(&metadata.clip_project).unwrap();
    metadata.metadata = json!({"transport": {"request": "fixture"}});
    write_valid("metadata-and-provenance", &metadata);

    let mut mismatch = one.clone();
    mismatch.edit_decision_list.clip_project_id = "other".into();
    write_invalid(
        "clip-project-edl-id-mismatch",
        &mismatch,
        "clip_project_edl_mismatch",
    );
    let mut revision = one.clone();
    revision.edit_decision_list.project_revision += 1;
    write_invalid("revision-mismatch", &revision, "project_revision_mismatch");
    let mut media = one.clone();
    media.edit_decision_list.source_media_id = "other".into();
    write_invalid("source-media-mismatch", &media, "source_media_mismatch");
    let mut duplicate = captions.clone();
    let duplicate_word = duplicate.remapped_transcript.as_ref().unwrap().words[0].clone();
    duplicate
        .remapped_transcript
        .as_mut()
        .unwrap()
        .words
        .push(duplicate_word);
    write_invalid(
        "duplicate-generated-caption-id",
        &duplicate,
        "duplicate_generated_id",
    );
    let mut unsupported_rate = one.clone();
    unsupported_rate.clip_project.ranges[0].playback_rate = 5.0;
    write_invalid(
        "unsupported-playback-rate",
        &unsupported_rate,
        "unsupported_playback_rate",
    );
    let mut beyond = captions.clone();
    beyond.remapped_transcript.as_mut().unwrap().words[0].output_end_ms =
        Some(beyond.edit_decision_list.output_duration_ms + 1);
    write_invalid(
        "caption-beyond-project-duration",
        &beyond,
        "caption_mapping_mismatch",
    );
    let mut missing_word = captions.clone();
    missing_word.remapped_transcript.as_mut().unwrap().segments[0]
        .word_occurrence_ids
        .push("missing_word".into());
    write_invalid(
        "missing-caption-word-reference",
        &missing_word,
        "caption_mapping_mismatch",
    );
    let mut invalid_canvas = one.clone();
    invalid_canvas.clip_project.canvas.width = 0;
    write_invalid("invalid-canvas", &invalid_canvas, "unsupported_canvas");
    let mut project_version = one;
    project_version.target_project_version = 34;
    write_invalid(
        "unsupported-project-schema-version",
        &project_version,
        "unsupported_capinsta_project_version",
    );
}

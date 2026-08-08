use super::*;
use clip_domain::{
    CaptionTrackReferenceV1, ClipBoundaryV1, ClipCanvasV1, ClipProjectSettingsV1, ClipRangeV1,
    RemappedSegmentOccurrenceV1, SourceMediaReferenceV1, SourceType,
};

fn project(rates: &[f64]) -> ClipProjectV1 {
    let mut cursor = 0_i64;
    let ranges = rates
        .iter()
        .enumerate()
        .map(|(index, rate)| {
            let start = cursor;
            cursor += 300;
            ClipRangeV1 {
                schema_version: 1,
                id: format!("range_{index:03}"),
                source_media_id: "media_001".into(),
                source_start_ms: start,
                source_end_ms: cursor,
                order: index as u64,
                playback_rate: *rate,
                selection: None,
                boundary: ClipBoundaryV1::default(),
                transition_in: None,
                transition_out: None,
                enabled: true,
                label: None,
                metadata: json!({}),
            }
        })
        .collect();
    ClipProjectV1 {
        schema_version: 1,
        clip_project_id: "clip_project_001".into(),
        workspace_id: None,
        name: "Synthetic clip".into(),
        source_media: SourceMediaReferenceV1 {
            media_id: "media_001".into(),
            duration_ms: 10_000,
            source_type: SourceType::Uploaded,
            display_name: Some("source.mp4".into()),
            mime_type: Some("video/mp4".into()),
            storage_key: Some("portable/media_001".into()),
            checksum: None,
            metadata: json!({}),
        },
        transcript_id: Some("tr_001".into()),
        transcript_revision: Some(1),
        ranges,
        canvas: ClipCanvasV1 {
            aspect_ratio: "9:16".into(),
            width: 1080,
            height: 1920,
            background: Some("#000000".into()),
            safe_area: None,
            metadata: json!({}),
        },
        caption_track: Some(CaptionTrackReferenceV1 {
            caption_track_id: "captions_001".into(),
            transcript_id: Some("tr_001".into()),
            style_preset_id: Some("word_highlight_box".into()),
            enabled: true,
            metadata: json!({}),
        }),
        settings: ClipProjectSettingsV1::default(),
        status: "ready".into(),
        revision: 1,
        metadata: json!({}),
        created_at: "2026-07-24T12:00:00Z".into(),
        updated_at: "2026-07-24T12:00:00Z".into(),
    }
}

fn input(rates: &[f64]) -> ClipProjectConversionInputV1 {
    let clip_project = project(rates);
    let edit_decision_list = generate_edit_decision_list(&clip_project).unwrap();
    ClipProjectConversionInputV1 {
        schema_version: 1,
        clip_project,
        edit_decision_list,
        remapped_transcript: None,
        target_project_id: "project_001".into(),
        target_project_version: 35,
        options: ClipProjectConversionOptionsV1 {
            include_captions: true,
            preserve_disabled_ranges: false,
            create_separate_tracks: false,
            unsupported_feature_policy: UnsupportedFeaturePolicy::Warn,
        },
        metadata: json!({"transport": "test"}),
    }
}

fn remapped(input: &ClipProjectConversionInputV1) -> RemappedTranscriptV1 {
    RemappedTranscriptV1 {
        schema_version: 1,
        source_transcript_id: "tr_001".into(),
        clip_project_id: input.clip_project.clip_project_id.clone(),
        project_revision: input.clip_project.revision,
        source_media_id: input.clip_project.source_media.media_id.clone(),
        output_duration_ms: input.edit_decision_list.output_duration_ms,
        segments: vec![RemappedSegmentOccurrenceV1 {
            occurrence_id: "range_000__seg_001".into(),
            source_segment_id: "seg_001".into(),
            range_id: "range_000".into(),
            text: "Displayed text".into(),
            original_text: Some("Original text".into()),
            original_source_start_ms: Some(0),
            original_source_end_ms: Some(300),
            effective_source_start_ms: Some(0),
            effective_source_end_ms: Some(300),
            output_start_ms: Some(0),
            output_end_ms: Some(300),
            word_occurrence_ids: vec!["range_000__word_001".into()],
            speaker_id: Some("speaker_001".into()),
            language: Some("en".into()),
            confidence: Some(0.9),
            timing_source: TimingSource::ManuallyAdjusted,
            metadata: json!({}),
        }],
        words: vec![RemappedWordOccurrenceV1 {
            occurrence_id: "range_000__word_001".into(),
            source_word_id: "word_001".into(),
            source_segment_id: "seg_001".into(),
            range_id: "range_000".into(),
            text: "Displayed".into(),
            original_text: Some("Original".into()),
            original_source_start_ms: Some(0),
            original_source_end_ms: Some(300),
            effective_source_start_ms: Some(0),
            effective_source_end_ms: Some(300),
            output_start_ms: Some(0),
            output_end_ms: Some(300),
            speaker_id: Some("speaker_001".into()),
            language: Some("en".into()),
            confidence: Some(0.9),
            timing_source: TimingSource::ManuallyAdjusted,
            is_filler: false,
            is_low_confidence: true,
            metadata: json!({}),
        }],
        warnings: vec![],
        metadata: json!({}),
    }
}

#[test]
fn converts_one_range_with_source_trims_and_combined_audio() {
    let result = convert_clip_project_to_capinsta(&input(&[1.0])).unwrap();
    let element = &result.project.scenes[0].tracks.main.elements[0];
    assert_eq!(element.media_id, "media_001");
    assert_eq!(element.trim_start, 0);
    assert_eq!(element.trim_end, 9_700 * TICKS_PER_MILLISECOND);
    assert_eq!(element.duration, 300 * TICKS_PER_MILLISECOND);
    assert!(element.is_source_audio_enabled);
    assert!(result.project.scenes[0].tracks.audio.is_empty());
}

#[test]
fn preserves_order_repetition_overlap_and_contiguity() {
    let mut value = input(&[1.0, 1.0, 1.0]);
    value.clip_project.ranges[0].source_start_ms = 2_000;
    value.clip_project.ranges[0].source_end_ms = 2_300;
    value.clip_project.ranges[1].source_start_ms = 100;
    value.clip_project.ranges[1].source_end_ms = 400;
    value.clip_project.ranges[2].source_start_ms = 100;
    value.clip_project.ranges[2].source_end_ms = 400;
    value.edit_decision_list = generate_edit_decision_list(&value.clip_project).unwrap();
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    assert_eq!(
        result
            .mapping
            .range_mappings
            .iter()
            .map(|mapping| mapping.source_start_ms)
            .collect::<Vec<_>>(),
        vec![2_000, 100, 100]
    );
    assert!(
        result
            .mapping
            .range_mappings
            .windows(2)
            .all(|window| { window[0].timeline_end_ms == window[1].timeline_start_ms })
    );
}

#[test]
fn mixed_rate_regression_totals_1090_ms() {
    let result = convert_clip_project_to_capinsta(&input(&[0.75, 1.0, 1.25, 2.0])).unwrap();
    assert_eq!(
        result.project.metadata.duration,
        1_090 * TICKS_PER_MILLISECOND
    );
    assert_eq!(
        result
            .mapping
            .range_mappings
            .last()
            .unwrap()
            .timeline_end_ms,
        1_090
    );
    assert_eq!(
        result.project.scenes[0].tracks.main.elements[3]
            .retime
            .as_ref()
            .unwrap()
            .rate,
        2.0
    );
}

#[test]
fn rejects_project_edl_revision_media_and_duration_mismatches() {
    let mut cases = Vec::new();
    let mut id = input(&[1.0]);
    id.edit_decision_list.clip_project_id = "other".into();
    cases.push((id, "clip_project_edl_mismatch"));
    let mut revision = input(&[1.0]);
    revision.edit_decision_list.project_revision = 2;
    cases.push((revision, "project_revision_mismatch"));
    let mut media = input(&[1.0]);
    media.edit_decision_list.source_media_id = "other".into();
    cases.push((media, "source_media_mismatch"));
    let mut duration = input(&[1.0]);
    duration.edit_decision_list.output_duration_ms += 1;
    cases.push((duration, "invalid_timeline_duration"));
    for (value, expected) in cases {
        let errors = convert_clip_project_to_capinsta(&value).unwrap_err();
        assert!(errors.iter().any(|error| error.category == expected));
    }
}

#[test]
fn empty_and_disabled_projects_are_valid_and_disabled_ranges_are_omitted() {
    let empty = convert_clip_project_to_capinsta(&input(&[])).unwrap();
    assert_eq!(empty.project.metadata.duration, 0);
    let mut disabled = input(&[1.0]);
    disabled.clip_project.ranges[0].enabled = false;
    disabled.edit_decision_list = generate_edit_decision_list(&disabled.clip_project).unwrap();
    let result = convert_clip_project_to_capinsta(&disabled).unwrap();
    assert!(result.mapping.range_mappings.is_empty());
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.category == "disabled_range_omitted")
    );
}

#[test]
fn maps_custom_canvas_and_warns_for_safe_area() {
    let mut value = input(&[1.0]);
    value.clip_project.canvas.aspect_ratio = "custom".into();
    value.clip_project.canvas.width = 1234;
    value.clip_project.canvas.height = 777;
    value.clip_project.canvas.safe_area = Some(json!({"top": 20}));
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    assert_eq!(result.project.settings.canvas_size.width, 1234);
    assert_eq!(result.project.settings.canvas_size_mode, "custom");
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.category == "canvas_safe_area_not_supported")
    );
}

#[test]
fn maps_editable_captions_without_retiming_words() {
    let mut value = input(&[1.0]);
    value.remapped_transcript = Some(remapped(&value));
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    let record = &result.project.capinsta_caption_documents.as_ref().unwrap()[0];
    assert_eq!(record.document.words[0].start, 0.0);
    assert_eq!(record.document.words[0].end, 0.3);
    assert_eq!(record.document.words[0].displayed_text, "Displayed");
    assert_eq!(
        record.document.words[0].original_text.as_deref(),
        Some("Original")
    );
    assert_eq!(record.document.clips[0].timing_source, "manual");
    assert_eq!(result.mapping.caption_mappings.len(), 1);
}

#[test]
fn automatic_composition_maps_editable_hook_reframe_and_caption_spacing() {
    let mut value = input(&[1.0]);
    value.remapped_transcript = Some(remapped(&value));
    value.clip_project.metadata = json!({
        "automaticClipper": {
            "reframePlan": {
                "sourceWidth": 1920,
                "sourceHeight": 1080,
                "shots": [{
                    "sourceStartMs": 0,
                    "sourceEndMs": 300,
                    "strategy": "single_subject_crop",
                    "cropKeyframes": [
                        {"id": "crop_1", "sourceTimeMs": 0, "centerX": 0.3, "centerY": 0.4, "scale": 1.0},
                        {"id": "crop_2", "sourceTimeMs": 300, "centerX": 0.5, "centerY": 0.4, "scale": 1.0}
                    ]
                }]
            },
            "hookOverlay": {
                "text": "A synthetic hook",
                "supportingEmojis": ["👨🏽‍💻", "✨"],
                "startMs": 0,
                "endMs": 300,
                "position": "top"
            },
            "safeZone": {"hookCenterYPx": -560},
            "captionComposition": {
                "wordSpacing": 12,
                "maximumLines": 2,
                "positionY": 74,
                "maximumWidth": 82
            }
        }
    });
    value.edit_decision_list = generate_edit_decision_list(&value.clip_project).unwrap();
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    let scene = &result.project.scenes[0];
    assert!(scene.tracks.main.elements[0].animations.is_some());
    let hook = scene
        .tracks
        .overlay
        .iter()
        .find_map(|track| match track {
            CapinstaOverlayTrackV35::Text(track) if track.name == "Automatic hook" => Some(track),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        hook.elements[0].params["content"],
        json!("A synthetic hook 👨🏽‍💻 ✨")
    );
    assert_eq!(
        hook.elements[0].params["fontFamily"],
        json!("Poppins, Noto Color Emoji")
    );
    let document = &result.project.capinsta_caption_documents.as_ref().unwrap()[0].document;
    assert_eq!(
        document.clips[0].style_overrides,
        Some(json!({
            "text": {"wordSpacing": 12.0, "maxLines": 2},
            "layout": {"positionY": 74.0, "maxWidth": 82.0, "safeAreaEnabled": true}
        }))
    );
}

#[test]
fn automatic_multi_subject_layout_uses_editable_video_layers_and_blur() {
    let mut value = input(&[1.0]);
    value.clip_project.metadata = json!({
        "automaticClipper": {
            "reframePlan": {
                "sourceWidth": 1920,
                "sourceHeight": 1080,
                "shots": [{
                    "sourceStartMs": 0,
                    "sourceEndMs": 300,
                    "strategy": "dual_subject_split",
                    "layoutRegions": [
                        {"id":"left","role":"subject_1","sourceCenterX":0.25,"sourceCenterY":0.4,
                         "outputCenterX":0.5,"outputCenterY":0.25,"outputWidth":1.0,"outputHeight":0.5},
                        {"id":"right","role":"subject_2","sourceCenterX":0.75,"sourceCenterY":0.4,
                         "outputCenterX":0.5,"outputCenterY":0.75,"outputWidth":1.0,"outputHeight":0.5}
                    ]
                }]
            }
        }
    });
    value.edit_decision_list = generate_edit_decision_list(&value.clip_project).unwrap();
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    assert_eq!(result.project.settings.background.background_type, "blur");
    assert_eq!(
        result.project.settings.background.blur_intensity,
        Some(30.0)
    );
    assert_eq!(
        result.project.scenes[0]
            .tracks
            .overlay
            .iter()
            .filter(|track| matches!(track, CapinstaOverlayTrackV35::Video(_)))
            .count(),
        2
    );
}

#[test]
fn omits_untimed_words_with_a_structured_warning() {
    let mut value = input(&[1.0]);
    let mut transcript = remapped(&value);
    transcript.words[0].output_start_ms = None;
    transcript.words[0].output_end_ms = None;
    transcript.segments[0].word_occurrence_ids.clear();
    value.remapped_transcript = Some(transcript);
    let result = convert_clip_project_to_capinsta(&value).unwrap();
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.category == "untimed_caption_word_omitted")
    );
}

#[test]
fn error_policy_rejects_unsupported_data() {
    let mut value = input(&[1.0]);
    value.options.unsupported_feature_policy = UnsupportedFeaturePolicy::Error;
    value.clip_project.canvas.safe_area = Some(json!({"top": 10}));
    let errors = convert_clip_project_to_capinsta(&value).unwrap_err();
    assert_eq!(errors[0].severity, ProjectConversionSeverity::Error);
    assert!(
        errors
            .iter()
            .any(|error| error.category == "canvas_safe_area_not_supported")
    );
}

#[test]
fn conversion_is_byte_deterministic_and_does_not_mutate_input() {
    let value = input(&[0.5, 1.0, 2.0]);
    let before = serde_json::to_string(&value).unwrap();
    let first = convert_clip_project_to_capinsta(&value).unwrap();
    let second = convert_clip_project_to_capinsta(&value).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap()
    );
    assert_eq!(serde_json::to_string(&value).unwrap(), before);
}

#[test]
fn standard_canvas_presets_and_slower_faster_rates_map_exactly() {
    for (aspect_ratio, width, height) in [
        ("9:16", 1080, 1920),
        ("16:9", 1920, 1080),
        ("1:1", 1080, 1080),
        ("4:5", 1080, 1350),
    ] {
        let mut value = input(&[0.5, 2.0]);
        value.clip_project.canvas.aspect_ratio = aspect_ratio.into();
        value.clip_project.canvas.width = width;
        value.clip_project.canvas.height = height;
        value.edit_decision_list = generate_edit_decision_list(&value.clip_project).unwrap();
        let result = convert_clip_project_to_capinsta(&value).unwrap();
        assert_eq!(result.project.settings.canvas_size.width, width);
        assert_eq!(result.project.settings.canvas_size.height, height);
        assert_eq!(result.mapping.range_mappings[0].output_duration_ms, 600);
        assert_eq!(result.mapping.range_mappings[1].output_duration_ms, 150);
    }
}

#[test]
fn source_media_reference_contains_no_storage_path_and_survives_json() {
    let result = convert_clip_project_to_capinsta(&input(&[1.0])).unwrap();
    let json = serde_json::to_string(&result).unwrap();
    assert!(!json.contains("portable/media_001"));
    let restored: CapinstaProjectConversionResultV1 = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.media_reference.media_id, "media_001");
    assert_eq!(
        restored.project.scenes[0].tracks.main.elements[0].source_asset_id,
        "media_001"
    );
}

#[test]
fn generated_fixture_matrix_matches_the_converter() {
    let root = "../../../contracts/fixtures/capinsta-project-conversion-v1";
    let valid = std::fs::read_dir(format!("{root}/valid")).unwrap();
    let mut valid_count = 0;
    for entry in valid {
        let raw = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        let fixture_input: ClipProjectConversionInputV1 =
            serde_json::from_value(envelope["input"].clone()).unwrap();
        let expected: CapinstaProjectConversionResultV1 =
            serde_json::from_value(envelope["result"].clone()).unwrap();
        assert_eq!(
            convert_clip_project_to_capinsta(&fixture_input).unwrap(),
            expected
        );
        valid_count += 1;
    }
    assert_eq!(valid_count, 14);

    let invalid = std::fs::read_dir(format!("{root}/invalid")).unwrap();
    let mut invalid_count = 0;
    for entry in invalid {
        let raw = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        let fixture_input: ClipProjectConversionInputV1 =
            serde_json::from_value(envelope["input"].clone()).unwrap();
        let expected = envelope["expectedIssueCategory"].as_str().unwrap();
        let errors = convert_clip_project_to_capinsta(&fixture_input).unwrap_err();
        assert!(
            errors.iter().any(|error| error.category == expected),
            "expected {expected}, got {errors:?}"
        );
        invalid_count += 1;
    }
    assert_eq!(invalid_count, 9);
}

# Caption Workflow

Huygen Caps now defaults to a caption-first workflow instead of a full Premiere-style editor.

## Primary Flow

1. Import a video.
2. Open the Subtitles panel.
3. Choose the original spoken language.
4. Choose the subtitle output mode.
5. Click Auto Subtitle.
6. Edit subtitle rows with start time, text, and end time.
7. Adjust Chars per subtitle and rebuild when needed.
8. Style captions from the right panel.
9. Export MP4, SRT, ASS, JSON, or project data.

## Auto Subtitle Setup

The setup panel exposes only the settings needed before generation:

- Original language
- Translate video to
- Auto Subtitle
- Cancel while a generation job is running

Original language maps into the existing backend language modes. Telugu output uses the Telgish/Teluglish Roman caption mode, Hindi output uses Hinglish, and Auto Detect/Auto Mixed Indian uses the code-mixed mode.

## Subtitle Rows

Generated subtitles are edited in rows:

```text
00:01.410    subtitle text    00:02.360
```

Clicking a row selects that caption chunk and seeks the preview to its start time. Editing text updates the caption store immediately, so preview and export use the edited text. Editing start/end times updates the same caption chunk used by the timeline.

## Chars Per Subtitle

The visible beginner control is `Chars per subtitle`.

- `18-24`: short 2-3 word captions.
- `25-45`: normal 4-5 word captions.
- `46-90`: longer sentence-like captions.
- `91-160`: paragraph-style chunks.

Changing this control marks the subtitles as rebuild-required. Rebuild Subtitles uses the original aligned transcript segments and does not re-run speech recognition.

## Live Styling

The right Caption Style panel updates live:

- Font
- Font size
- Line height
- Text color
- Background color
- Background Wrap / Fill
- Background opacity
- Corners
- Padding
- Background border
- Text outline

These settings write to `captionStyleConfig`, which is read by both the preview renderer and the headless export renderer.

## Caption Layer Behavior

Captions behave like one connected subtitle layer:

- Caption chunks render in one subtitle track above video/audio.
- Clicking a row selects the matching timeline caption chunk.
- Clicking or trimming a timeline caption chunk updates the matching row through shared caption state.
- Style controls apply globally to all subtitles.
- Timing and text edits apply to the selected subtitle chunk.

## Advanced Features

The old editor engines are still present, but the default UI hides advanced NLE controls. Export, timeline trimming, media import, caption presets, Docker/Render routes, and backend jobs remain intact.

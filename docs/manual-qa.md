# Manual QA

## Caption Presets

Apply all six presets:

- Word Highlight Box
- Attention Punch
- Apple
- Kinetic Fade
- MrBeast
- Editorial Lockup

Confirm preview has no debug text, no oversized or cropped captions, active-word highlighting, and no duplicate captions.

## Core Flow

1. Start backend from `backend`.
2. Start frontend from the root folder.
3. Import a real video with speech.
4. Confirm video preview is visible and audio plays.
5. Confirm video/audio are separate but linked.
6. Click Generate AI Captions.
7. Confirm captions enter the timeline.
8. Apply at least three presets, including MrBeast and Word Highlight Box.
9. Scrub/play and confirm active-word highlighting.
10. Edit one caption.
11. Move one caption.
12. Reload the project and confirm metadata persists.

## Export QA

Export MP4 and confirm video, audio, styled subtitles, no debug text, no duplicate subtitles, edited captions, moved timing, and normal OpenCut text/subtitle export.

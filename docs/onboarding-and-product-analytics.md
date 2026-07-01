# Onboarding And Product Analytics

## Onboarding Checklist

Recommended server-stored steps:

1. Account created.
2. Email verified.
3. First project created.
4. Supported upload types and limits viewed.
5. First supported media uploaded.
6. Upload validation completed.
7. Language/provider/timing preset selected.
8. Caption job started.
9. Caption editor opened.
10. Captions reviewed or edited.
11. First export started.
12. First export completed.

The checklist must be skippable and must not block core editor use.

## Event Taxonomy

Use versioned names:

- `signup_completed`
- `email_verified`
- `project_created`
- `upload_started`
- `upload_rejected`
- `upload_completed`
- `transcription_started`
- `transcription_completed`
- `transcription_failed`
- `caption_editor_opened`
- `caption_edited`
- `export_started`
- `export_completed`
- `export_failed`
- `onboarding_step_completed`

Do not send raw captions, videos, passwords, tokens, signed URLs, full email addresses, or secret values.


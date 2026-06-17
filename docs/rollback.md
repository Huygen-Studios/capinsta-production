# Rollback

Set `NEXT_PUBLIC_ENABLE_AI_CAPTIONS=false` to hide Generate AI Captions and keep normal editing/export available.

Set `NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT=false` to disable sample caption import.

Capinsta caption metadata is optional. Existing projects without `capinstaCaptionDocuments` still load.

Stop the backend process to disable live caption generation. Existing generated caption clips remain ordinary project timeline elements.

Checkpoint tags in the source/reference folders:

- frontend/reference: `capinsta-style-stage-13-complete`
- backend/reference: `capinsta-backend-stage-9-complete`

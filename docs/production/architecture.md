# Production architecture

Public HTTPS reaches only Next.js and FastAPI. Supabase provides Auth,
PostgreSQL, and the private `source-media`, `media-variants`, and
`media-exports` buckets. Workers use the backend image without public ports.

Deploy one API and bounded worker roles for media, transcription/analysis, and
export. For the initial beta, media and analysis may share a worker at
concurrency one; export stays separate because Chromium has different memory
behavior. All workers use the existing PostgreSQL lease queue and Rust runtime.

Long media work never runs in the API. Redis/Upstash remains limited to the
existing short-lived rate-limit and assertion-replay use.

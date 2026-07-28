# Coolify deployment

Use the existing Coolify installation and
`docker-compose.production.yml`. It pulls immutable web/backend images from
GHCR; it does not build on the VPS and does not run PostgreSQL or permanent
customer-media volumes.

GitHub environment variables:

```text
APPLICATION_URL
SUPABASE_URL
SUPABASE_ANON_KEY
CAPINSTA_MIGRATION_BASELINE=<latest migration already verified in the target database>
```

GitHub environment secrets:

```text
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COOLIFY_DEPLOY_WEBHOOK
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ADMIN_SECURITY_PEPPER
INTERNAL_ADMIN_API_SECRET
INTERNAL_MAINTENANCE_SECRET
CAPINSTA_RENDER_TOKEN_SECRET
```

Configure the remaining values from `production.env.example` in Coolify.
Keep all three admission flags `true` for the first deployment. Set exact HTTPS
origins, the private-beta allowlist, and at least one real transcription and
candidate-provider credential.

Run the `Production candidate` workflow with `staging` and deploy disabled.
After Linux verification and image smoke tests pass, run it with staging deploy
enabled. The workflow applies additive migrations under a PostgreSQL advisory
lock, triggers Coolify, verifies web/API health, and only then promotes
`latest`.

Workers expose no ports and use concurrency one. The proxy routes API traffic
through the web service. Run a cleanup dry-run and an internal 30–60 minute
upload before changing the admission flags.

Rollback:

```text
CAPINSTA_IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.production.yml up -d
```

Additive migrations are not rolled back destructively.

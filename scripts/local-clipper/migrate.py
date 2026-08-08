"""Apply the existing migration stream to the disposable local Clipper database."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "apps" / "web" / "migrations"
LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001"

BOOTSTRAP = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'email', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL, owner_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(bucket_id,name)
);
"""


def main() -> None:
    database_url = os.environ["ADMIN_DATABASE_URL"]
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(BOOTSTRAP)
        connection.execute(
            "CREATE TABLE IF NOT EXISTS capinsta_local_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if connection.execute(
                "SELECT 1 FROM capinsta_local_migrations WHERE name=%s", (path.name,)
            ).fetchone():
                continue
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO capinsta_local_migrations(name) VALUES(%s)", (path.name,)
            )
            print(f"applied {path.name}")
        connection.execute(
            "INSERT INTO auth.users(id,email) VALUES(%s,%s) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email",
            (LOCAL_USER_ID, "local-clipper@capinsta.invalid"),
        )


if __name__ == "__main__":
    main()

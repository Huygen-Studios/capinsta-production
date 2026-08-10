CREATE TABLE system_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]', severity text NOT NULL DEFAULT 'warning',
  enabled boolean NOT NULL DEFAULT true, starts_at timestamptz, ends_at timestamptz,
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_notifications_active_idx ON system_notifications (enabled, starts_at, ends_at);
CREATE TABLE user_onboarding (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, source text, source_other text,
  use_case text, use_case_other text, experience_level text, main_goal text, main_goal_other text,
  completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5), comment text,
  context text NOT NULL DEFAULT 'post_editor_session', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_ratings_user_created_idx ON user_ratings (user_id, created_at);
ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS page_url text, ADD COLUMN IF NOT EXISTS os text,
  ADD COLUMN IF NOT EXISTS viewport text;

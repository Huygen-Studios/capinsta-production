CREATE TABLE IF NOT EXISTS public.product_events (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	event_name text NOT NULL CHECK (
		event_name IN (
			'signup_completed',
			'project_created',
			'media_upload_completed',
			'media_upload_failed',
			'caption_job_started',
			'caption_job_completed',
			'caption_job_failed',
			'export_started',
			'export_completed',
			'export_failed',
			'private_server_request_submitted',
			'donation_completed',
			'donation_failed',
			'donation_refunded'
		)
	),
	occurred_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
	user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	project_id text,
	media_asset_id text,
	caption_job_id text,
	export_job_id text,
	environment text NOT NULL DEFAULT 'production',
	event_key text NOT NULL,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS product_events_event_key_unique
	ON public.product_events(event_key);

CREATE INDEX IF NOT EXISTS product_events_name_occurred_idx
	ON public.product_events(event_name, occurred_at);

CREATE INDEX IF NOT EXISTS product_events_user_occurred_idx
	ON public.product_events(user_id, occurred_at);

CREATE INDEX IF NOT EXISTS product_events_caption_job_idx
	ON public.product_events(caption_job_id);

CREATE INDEX IF NOT EXISTS product_events_export_job_idx
	ON public.product_events(export_job_id);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_events FROM anon, authenticated;

DROP POLICY IF EXISTS "product_events_service_role_all" ON public.product_events;
CREATE POLICY "product_events_service_role_all"
	ON public.product_events
	TO service_role
	USING (true)
	WITH CHECK (true);

DROP POLICY IF EXISTS "product_events_admin_read" ON public.product_events;
CREATE POLICY "product_events_admin_read"
	ON public.product_events
	FOR SELECT
	TO authenticated
	USING (public.capinsta_has_admin_role(NULL));

CREATE OR REPLACE FUNCTION public.capinsta_record_signup_product_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
	INSERT INTO public.product_events (
		event_name,
		occurred_at,
		user_id,
		environment,
		event_key,
		metadata
	)
	VALUES (
		'signup_completed',
		COALESCE(NEW.created_at, timezone('utc', now())),
		NEW.id,
		COALESCE(current_setting('app.environment', true), 'production'),
		'signup_completed:' || NEW.id::text,
		jsonb_build_object('source', 'auth.users')
	)
	ON CONFLICT (event_key) DO NOTHING;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_record_signup_product_event ON auth.users;
CREATE TRIGGER on_auth_user_record_signup_product_event
	AFTER INSERT ON auth.users
	FOR EACH ROW
	EXECUTE FUNCTION public.capinsta_record_signup_product_event();

CREATE OR REPLACE FUNCTION public.capinsta_record_project_created_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	INSERT INTO public.product_events (
		event_name,
		occurred_at,
		user_id,
		project_id,
		environment,
		event_key,
		metadata
	)
	VALUES (
		'project_created',
		COALESCE(NEW.created_at, timezone('utc', now())),
		NEW.user_id,
		NEW.project_id,
		COALESCE(current_setting('app.environment', true), 'production'),
		'project_created:' || NEW.project_id,
		jsonb_build_object('source', 'project_registry')
	)
	ON CONFLICT (event_key) DO NOTHING;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_project_registry_record_created_event ON public.project_registry;
CREATE TRIGGER on_project_registry_record_created_event
	AFTER INSERT ON public.project_registry
	FOR EACH ROW
	EXECUTE FUNCTION public.capinsta_record_project_created_event();

CREATE OR REPLACE FUNCTION public.capinsta_record_caption_job_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	event_to_record text;
	event_time timestamptz;
BEGIN
	IF TG_OP = 'INSERT' THEN
		event_to_record := 'caption_job_started';
		event_time := COALESCE(NEW.started_at, NEW.queued_at, NEW.created_at, timezone('utc', now()));
	ELSIF NEW.status IN ('completed', 'succeeded') AND OLD.status IS DISTINCT FROM NEW.status THEN
		event_to_record := 'caption_job_completed';
		event_time := COALESCE(NEW.completed_at, timezone('utc', now()));
	ELSIF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM NEW.status THEN
		event_to_record := 'caption_job_failed';
		event_time := timezone('utc', now());
	END IF;

	IF event_to_record IS NOT NULL THEN
		INSERT INTO public.product_events (
			event_name,
			occurred_at,
			user_id,
			project_id,
			caption_job_id,
			environment,
			event_key,
			metadata
		)
		VALUES (
			event_to_record,
			event_time,
			NEW.user_id,
			NEW.project_id,
			NEW.id,
			COALESCE(current_setting('app.environment', true), 'production'),
			event_to_record || ':' || NEW.id,
			jsonb_build_object('source', 'caption_jobs', 'status', NEW.status)
		)
		ON CONFLICT (event_key) DO NOTHING;
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_caption_jobs_record_product_event ON public.caption_jobs;
CREATE TRIGGER on_caption_jobs_record_product_event
	AFTER INSERT OR UPDATE OF status ON public.caption_jobs
	FOR EACH ROW
	EXECUTE FUNCTION public.capinsta_record_caption_job_event();

CREATE OR REPLACE FUNCTION public.capinsta_record_export_job_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	event_to_record text;
	event_time timestamptz;
BEGIN
	IF TG_OP = 'INSERT' THEN
		event_to_record := 'export_started';
		event_time := COALESCE(NEW.started_at, NEW.queued_at, NEW.created_at, timezone('utc', now()));
	ELSIF NEW.status IN ('completed', 'succeeded') AND OLD.status IS DISTINCT FROM NEW.status THEN
		event_to_record := 'export_completed';
		event_time := COALESCE(NEW.completed_at, timezone('utc', now()));
	ELSIF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM NEW.status THEN
		event_to_record := 'export_failed';
		event_time := timezone('utc', now());
	END IF;

	IF event_to_record IS NOT NULL THEN
		INSERT INTO public.product_events (
			event_name,
			occurred_at,
			user_id,
			project_id,
			export_job_id,
			environment,
			event_key,
			metadata
		)
		VALUES (
			event_to_record,
			event_time,
			NEW.user_id,
			NEW.project_id,
			NEW.id,
			COALESCE(current_setting('app.environment', true), 'production'),
			event_to_record || ':' || NEW.id,
			jsonb_build_object('source', 'export_jobs', 'status', NEW.status)
		)
		ON CONFLICT (event_key) DO NOTHING;
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_export_jobs_record_product_event ON public.export_jobs;
CREATE TRIGGER on_export_jobs_record_product_event
	AFTER INSERT OR UPDATE OF status ON public.export_jobs
	FOR EACH ROW
	EXECUTE FUNCTION public.capinsta_record_export_job_event();

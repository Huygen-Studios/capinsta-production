CREATE INDEX IF NOT EXISTS caption_jobs_status_completed_idx
	ON public.caption_jobs(status, completed_at);

CREATE INDEX IF NOT EXISTS export_jobs_status_completed_idx
	ON public.export_jobs(status, completed_at);

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
		event_time := COALESCE(NEW.completed_at, timezone('utc', now()));
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
		event_time := COALESCE(NEW.completed_at, timezone('utc', now()));
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

UPDATE public.caption_jobs
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status IN ('completed', 'succeeded', 'failed', 'cancelled')
	AND completed_at IS NULL;

UPDATE public.export_jobs
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status IN ('completed', 'succeeded', 'failed', 'cancelled', 'expired')
	AND completed_at IS NULL;

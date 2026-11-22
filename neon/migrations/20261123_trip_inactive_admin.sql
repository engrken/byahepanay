-- Admin-reviewed inactive trip lifecycle.
-- Preserve trip and sighting history; inactive is distinct from arrived/cancelled.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS inactive_at timestamptz,
  ADD COLUMN IF NOT EXISTS inactive_by_spotter_id uuid,
  ADD COLUMN IF NOT EXISTS inactive_reason text;

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'arrived'::text, 'cancelled'::text, 'inactive'::text]));

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_inactive_metadata_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_inactive_metadata_check CHECK (
    status <> 'inactive'
    OR (inactive_at IS NOT NULL AND inactive_by_spotter_id IS NOT NULL
        AND inactive_reason IS NOT NULL AND char_length(btrim(inactive_reason)) BETWEEN 10 AND 500)
  );

CREATE TABLE IF NOT EXISTS public.trip_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  previous_status text NOT NULL CHECK (previous_status IN ('active', 'arrived', 'cancelled', 'inactive')),
  new_status text NOT NULL CHECK (new_status IN ('arrived', 'cancelled', 'inactive')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  actor_spotter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_status_events_trip_created_idx
  ON public.trip_status_events(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trips_inactive_at_idx
  ON public.trips(inactive_at DESC) WHERE status = 'inactive';

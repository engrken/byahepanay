BEGIN;

CREATE TABLE IF NOT EXISTS public.app_presence (
  spotter_id uuid PRIMARY KEY,
  reporter_id uuid REFERENCES public.reporter_identities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_presence_last_seen_idx ON public.app_presence(last_seen_at);
CREATE INDEX IF NOT EXISTS app_presence_reporter_last_seen_idx ON public.app_presence(reporter_id,last_seen_at);

CREATE TABLE IF NOT EXISTS public.checkpoint_location_reviews (
  checkpoint_id uuid PRIMARY KEY REFERENCES public.checkpoints(id) ON DELETE CASCADE,
  previous_lat double precision,
  previous_lng double precision,
  proposed_lat double precision NOT NULL,
  proposed_lng double precision NOT NULL,
  source text NOT NULL,
  validation_status text NOT NULL DEFAULT 'pending_field_validation'
    CHECK (validation_status IN ('pending_field_validation','map_reviewed','field_verified')),
  note text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

INSERT INTO public.checkpoint_location_reviews
  (checkpoint_id,previous_lat,previous_lng,proposed_lat,proposed_lng,source,validation_status,note)
SELECT c.id,c.lat,c.lng,v.lat,v.lng,'project_owner_supplied','pending_field_validation',
  'Pilot coordinate supplied by the project owner. Exact roadside waiting point and highway side still require on-site confirmation.'
FROM public.checkpoints c
JOIN (VALUES
  ('lawaan',11.551354::double precision,122.758464::double precision),
  ('bolo',11.543040::double precision,122.758362::double precision),
  ('lanot',11.522087::double precision,122.757176::double precision),
  ('lonoy',11.510291::double precision,122.744620::double precision),
  ('ivisan',11.518743::double precision,122.697715::double precision)
) AS v(code,lat,lng) ON v.code=c.code
ON CONFLICT (checkpoint_id) DO NOTHING;

UPDATE public.checkpoints c
SET lat=v.lat,lng=v.lng
FROM (VALUES
  ('lawaan',11.551354::double precision,122.758464::double precision),
  ('bolo',11.543040::double precision,122.758362::double precision),
  ('lanot',11.522087::double precision,122.757176::double precision),
  ('lonoy',11.510291::double precision,122.744620::double precision),
  ('ivisan',11.518743::double precision,122.697715::double precision)
) AS v(code,lat,lng)
WHERE c.code=v.code;

COMMIT;

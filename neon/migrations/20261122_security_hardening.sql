-- Backfill stable ids for old reports and prevent duplicate retries.
ALTER TABLE public.sightings ADD COLUMN IF NOT EXISTS idempotency_key uuid;
UPDATE public.sightings SET idempotency_key = gen_random_uuid() WHERE idempotency_key IS NULL;
ALTER TABLE public.sightings ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid();
ALTER TABLE public.sightings ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sightings_idempotency_key_uidx ON public.sightings(idempotency_key);

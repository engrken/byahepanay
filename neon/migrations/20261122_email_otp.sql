-- Replace phone-specific reporter identities with email-backed identities.
ALTER TABLE public.reporter_identities ALTER COLUMN phone_hash DROP NOT NULL;
ALTER TABLE public.reporter_identities ALTER COLUMN phone_masked DROP NOT NULL;
ALTER TABLE public.reporter_identities ADD COLUMN IF NOT EXISTS email_hash text;
ALTER TABLE public.reporter_identities ADD COLUMN IF NOT EXISTS email_masked text;
ALTER TABLE public.reporter_identities ADD COLUMN IF NOT EXISTS verification_method text;

-- Existing phone identities stay identified as legacy SMS-verified; new rows default to email.
UPDATE public.reporter_identities
SET verification_method = CASE WHEN email_hash IS NOT NULL THEN 'email' ELSE 'sms' END
WHERE verification_method IS NULL;
ALTER TABLE public.reporter_identities ALTER COLUMN verification_method SET DEFAULT 'email';
ALTER TABLE public.reporter_identities ALTER COLUMN verification_method SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reporter_identities_email_hash_uidx
  ON public.reporter_identities(email_hash);

CREATE TABLE IF NOT EXISTS public.email_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotter_id uuid NOT NULL,
  email_hash text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('send','check')),
  provider_status text NOT NULL DEFAULT 'requested',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_verification_challenges (
  id uuid PRIMARY KEY,
  spotter_id uuid NOT NULL,
  email_hash text NOT NULL,
  email_masked text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verification_events_session_idx
  ON public.email_verification_events(spotter_id,event_type,created_at DESC);
CREATE INDEX IF NOT EXISTS email_verification_events_email_idx
  ON public.email_verification_events(email_hash,event_type,created_at DESC);
CREATE INDEX IF NOT EXISTS email_verification_challenges_lookup_idx
  ON public.email_verification_challenges(spotter_id,email_hash,created_at DESC);

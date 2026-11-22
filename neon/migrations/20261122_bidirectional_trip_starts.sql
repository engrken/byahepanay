-- Start a trip from any mapped checkpoint and seed reverse-direction corridors.
-- Existing trips are backfilled from their original departure sighting or route origin.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS start_checkpoint_id uuid REFERENCES public.checkpoints(id);

UPDATE public.trips t
SET start_checkpoint_id = COALESCE(
  (SELECT s.checkpoint_id
   FROM public.sightings s
   WHERE s.trip_id = t.id AND s.kind = 'departure'
   ORDER BY s.observed_at ASC, s.created_at ASC
   LIMIT 1),
  (SELECT rc.checkpoint_id
   FROM public.route_checkpoints rc
   WHERE rc.route_id = t.route_id
   ORDER BY rc.sequence ASC
   LIMIT 1),
  t.last_checkpoint_id
)
WHERE t.start_checkpoint_id IS NULL;

CREATE INDEX IF NOT EXISTS trips_start_checkpoint_idx
  ON public.trips(start_checkpoint_id);

INSERT INTO public.routes (id, name, short_name, destination, origin_name) VALUES
  ('iloilo_passi_return','Iloilo → Roxas City via Passi','Iloilo · Passi → Roxas','Pueblo de Panay Terminal','Tagbak Terminal (Iloilo)'),
  ('kalibo_mambusao_return','Kalibo → Roxas City via Mambusao','Kalibo · Mambusao → Roxas','Pueblo de Panay Terminal','Kalibo Terminal'),
  ('kalibo_sapian_return','Kalibo → Roxas City via Sapian','Kalibo · Sapian → Roxas','Pueblo de Panay Terminal','Kalibo Terminal'),
  ('tapaz_return','Calinog → Roxas City via Tapaz','Tapaz → Roxas','Pueblo de Panay Terminal','Calinog'),
  ('estancia_return','Estancia → Roxas City','Estancia → Roxas','Pueblo de Panay Terminal','Estancia Terminal')
ON CONFLICT (id) DO UPDATE
SET name=excluded.name, short_name=excluded.short_name,
    destination=excluded.destination, origin_name=excluded.origin_name;

WITH route_pairs(outbound_id, inbound_id) AS (
  VALUES
    ('iloilo_passi','iloilo_passi_return'),
    ('kalibo_mambusao','kalibo_mambusao_return'),
    ('kalibo_sapian','kalibo_sapian_return'),
    ('tapaz','tapaz_return'),
    ('estancia','estancia_return')
),
reversed AS (
  SELECT
    p.inbound_id AS route_id,
    rc.checkpoint_id,
    row_number() OVER (PARTITION BY rc.route_id ORDER BY rc.sequence DESC)::integer - 1 AS sequence,
    lag(rc.segment_minutes) OVER (PARTITION BY rc.route_id ORDER BY rc.sequence DESC) AS segment_minutes,
    rc.dwell_buffer_minutes,
    lag(rc.dwell_buffer_minutes) OVER (PARTITION BY rc.route_id ORDER BY rc.sequence DESC) AS previous_dwell
  FROM route_pairs p
  JOIN public.route_checkpoints rc ON rc.route_id = p.outbound_id
),
offsets AS (
  SELECT route_id, checkpoint_id, sequence,
         COALESCE(segment_minutes, 0)::integer AS segment_minutes,
         dwell_buffer_minutes,
         sum(CASE WHEN sequence = 0 THEN 0 ELSE COALESCE(segment_minutes, 0) + COALESCE(previous_dwell, 0) END)
           OVER (PARTITION BY route_id ORDER BY sequence ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS eta_offset_minutes
  FROM reversed
)
INSERT INTO public.route_checkpoints
  (route_id, checkpoint_id, sequence, eta_offset_minutes, segment_minutes, dwell_buffer_minutes)
SELECT route_id, checkpoint_id, sequence, eta_offset_minutes, segment_minutes, dwell_buffer_minutes
FROM offsets
ON CONFLICT (route_id, checkpoint_id) DO UPDATE
SET sequence=excluded.sequence, eta_offset_minutes=excluded.eta_offset_minutes,
    segment_minutes=excluded.segment_minutes, dwell_buffer_minutes=excluded.dwell_buffer_minutes;

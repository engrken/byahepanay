-- BiyahePanay PostgreSQL schema for Neon.
-- Planning coordinates and ETA offsets are approximate prototype anchors; field-check before public use.
create extension if not exists pgcrypto;

create table if not exists public.routes (
  id text primary key, name text not null, short_name text not null, destination text not null,
  origin_name text not null default 'Pueblo de Panay Terminal', is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180), created_at timestamptz not null default now()
);
create table if not exists public.route_checkpoints (
  route_id text not null references public.routes(id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  eta_offset_minutes integer not null check (eta_offset_minutes >= 0),
  segment_minutes integer not null default 0 check (segment_minutes >= 0),
  dwell_buffer_minutes integer not null default 0 check (dwell_buffer_minutes >= 0),
  primary key (route_id, checkpoint_id), unique (route_id, sequence)
);
create table if not exists public.buses (
  id uuid primary key default gen_random_uuid(), body_number text not null unique, plate_number text,
  bus_type text check (bus_type in ('ordinary', 'aircon')), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(), route_id text not null references public.routes(id),
  bus_id uuid references public.buses(id) on delete set null,
  bus_type text not null check (bus_type in ('ordinary', 'aircon')),
  departure_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'arrived', 'cancelled', 'inactive')),
  last_checkpoint_id uuid references public.checkpoints(id), last_checkpoint_at timestamptz,
  last_lat double precision, last_lng double precision,
  confidence_status text not null default 'verified' check (confidence_status in ('scheduled', 'unverified', 'verified')),
  pending_checkpoint_id uuid references public.checkpoints(id), pending_reported_at timestamptz,
  route_locked boolean not null default false, route_candidate text references public.routes(id),
  rider_status text, rider_status_at timestamptz,
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  inactive_at timestamptz, inactive_by_spotter_id uuid, inactive_reason text,
  check (status <> 'inactive' or (inactive_at is not null and inactive_by_spotter_id is not null
    and inactive_reason is not null and char_length(btrim(inactive_reason)) between 10 and 500))
);
create table if not exists public.trip_creator_sessions (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  spotter_id uuid not null, created_at timestamptz not null default now()
);
create table if not exists public.trip_rider_sessions (
  trip_id uuid not null references public.trips(id) on delete cascade, spotter_id uuid not null,
  joined_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  primary key (trip_id, spotter_id)
);
create table if not exists public.trip_status_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  previous_status text not null check (previous_status in ('active','arrived','cancelled','inactive')),
  new_status text not null check (new_status in ('arrived','cancelled','inactive')),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  actor_spotter_id uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.reporter_identities (
  id uuid primary key default gen_random_uuid(),
  phone_hash text unique, phone_masked text,
  email_hash text unique, email_masked text,
  verification_method text not null default 'email' check (verification_method in ('email','sms')),
  verified_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.spotter_reporter_links (
  spotter_id uuid primary key, reporter_id uuid not null references public.reporter_identities(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.phone_verification_events (
  id uuid primary key default gen_random_uuid(), spotter_id uuid not null, phone_hash text not null,
  event_type text not null check (event_type in ('send','check')), provider_status text not null default 'requested', created_at timestamptz not null default now()
);
create table if not exists public.email_verification_events (
  id uuid primary key default gen_random_uuid(), spotter_id uuid not null, email_hash text not null,
  event_type text not null check (event_type in ('send','check')), provider_status text not null default 'requested', created_at timestamptz not null default now()
);
create table if not exists public.email_verification_challenges (
  id uuid primary key, spotter_id uuid not null, email_hash text not null, email_masked text not null,
  code_hash text not null, expires_at timestamptz not null, attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.sightings (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints(id), spotter_id uuid not null,
  idempotency_key uuid not null default gen_random_uuid(), reporter_id uuid references public.reporter_identities(id) on delete set null,
  gps_accuracy_m double precision, kind text not null check (kind in ('departure', 'roadside', 'rider_beacon')),
  lat double precision not null, lng double precision not null,
  distance_meters double precision not null default 0, implied_speed_kmh double precision,
  is_verified boolean not null default false,
  confidence_status text not null default 'unverified' check (confidence_status in ('unverified', 'verified')),
  rider_status text, created_at timestamptz not null default now(), observed_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists public.eta_calibration_samples (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
  route_id text not null references public.routes(id), from_checkpoint_id uuid not null references public.checkpoints(id),
  to_checkpoint_id uuid not null references public.checkpoints(id), bus_type text not null check (bus_type in ('ordinary','aircon')),
  baseline_minutes numeric(8,2) not null, observed_minutes numeric(8,2) not null, reporter_count integer not null,
  mean_gps_accuracy_m numeric(8,2) not null, quality_score numeric(5,2) not null, observed_at timestamptz not null,
  created_at timestamptz not null default now(), unique (trip_id,to_checkpoint_id)
);
create table if not exists public.eta_segment_calibrations (
  route_id text not null references public.routes(id), from_checkpoint_id uuid not null references public.checkpoints(id),
  to_checkpoint_id uuid not null references public.checkpoints(id), bus_type text not null check (bus_type in ('ordinary','aircon')),
  sample_count integer not null, median_minutes numeric(8,2) not null, p80_minutes numeric(8,2) not null,
  baseline_minutes numeric(8,2) not null, last_sample_at timestamptz not null, updated_at timestamptz not null default now(),
  primary key (route_id,from_checkpoint_id,to_checkpoint_id,bus_type)
);
create table if not exists public.report_quality_daily (
  metric_date date primary key, report_count integer not null default 0, verified_report_count integer not null default 0,
  otp_verified_report_count integer not null default 0, unique_verified_reporters integer not null default 0,
  median_gps_accuracy_m numeric(8,2), median_report_distance_m numeric(8,2), calibration_sample_count integer not null default 0,
  calibrated_segment_count integer not null default 0, average_quality_score numeric(5,2), updated_at timestamptz not null default now()
);
create table if not exists public.ops_health_snapshots (
  id uuid primary key default gen_random_uuid(), status text not null check (status in ('healthy','degraded','unavailable')),
  database_latency_ms integer not null, active_trip_count integer not null, stale_active_trip_count integer not null,
  calibration_segment_count integer not null, latest_sighting_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ops_alerts (
  alert_key text primary key, severity text not null check (severity in ('info','warning','critical')), message text not null,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), resolved_at timestamptz
);

create index if not exists route_checkpoints_route_sequence_idx on public.route_checkpoints(route_id, sequence);
create index if not exists trips_active_route_departure_idx on public.trips(route_id, departure_at desc) where status = 'active';
create index if not exists trips_updated_at_idx on public.trips(updated_at desc);
create index if not exists trips_inactive_at_idx on public.trips(inactive_at desc) where status = 'inactive';
create index if not exists trip_status_events_trip_created_idx on public.trip_status_events(trip_id,created_at desc);
create unique index if not exists sightings_idempotency_key_uidx on public.sightings(idempotency_key);
create index if not exists sightings_reporter_time_idx on public.sightings(reporter_id,created_at desc);
create index if not exists phone_verification_events_session_idx on public.phone_verification_events(spotter_id,event_type,created_at desc);
create index if not exists phone_verification_events_phone_idx on public.phone_verification_events(phone_hash,event_type,created_at desc);
create index if not exists email_verification_events_session_idx on public.email_verification_events(spotter_id,event_type,created_at desc);
create index if not exists email_verification_events_email_idx on public.email_verification_events(email_hash,event_type,created_at desc);
create index if not exists email_verification_challenges_lookup_idx on public.email_verification_challenges(spotter_id,email_hash,created_at desc);
create index if not exists eta_calibration_samples_segment_idx on public.eta_calibration_samples(route_id,from_checkpoint_id,to_checkpoint_id,bus_type,created_at desc);
create index if not exists ops_health_snapshots_created_idx on public.ops_health_snapshots(created_at desc);
create index if not exists report_quality_daily_date_idx on public.report_quality_daily(metric_date desc);
create index if not exists sightings_trip_checkpoint_time_idx on public.sightings(trip_id, checkpoint_id, created_at desc);
create index if not exists sightings_trip_checkpoint_observed_idx on public.sightings(trip_id, checkpoint_id, observed_at desc);
create index if not exists sightings_spotter_kind_time_idx on public.sightings(spotter_id, kind, created_at desc);
create index if not exists sightings_created_at_idx on public.sightings(created_at desc);
create index if not exists trip_creator_sessions_spotter_idx on public.trip_creator_sessions(spotter_id, created_at desc);
create index if not exists trip_rider_sessions_spotter_idx on public.trip_rider_sessions(spotter_id, last_seen_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'buses_set_updated_at' and tgrelid = 'public.buses'::regclass) then
    create trigger buses_set_updated_at before update on public.buses
    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trips_set_updated_at' and tgrelid = 'public.trips'::regclass) then
    create trigger trips_set_updated_at before update on public.trips
    for each row execute function public.set_updated_at();
  end if;
end
$$;

insert into public.routes (id, name, short_name, destination, origin_name) values
 ('iloilo_passi','Roxas City → Iloilo via Passi','Iloilo · Passi','Tagbak Terminal','Pueblo de Panay Terminal'),
 ('kalibo_mambusao','Roxas City → Kalibo via Mambusao','Kalibo · Mambusao','Kalibo Terminal','Pueblo de Panay Terminal'),
 ('kalibo_sapian','Roxas City → Kalibo via Sapian','Kalibo · Sapian','Kalibo Terminal','Pueblo de Panay Terminal'),
 ('tapaz','Roxas City → Tapaz / Calinog','Tapaz','Calinog','Pueblo de Panay Terminal'),
 ('estancia','Roxas City → Estancia','Estancia','Estancia Terminal','Pueblo de Panay Terminal')
on conflict (id) do update set name=excluded.name, short_name=excluded.short_name, destination=excluded.destination;

insert into public.checkpoints (code,name,lat,lng) values
 ('pueblo_terminal','Pueblo de Panay Terminal',11.55987,122.74805),
 ('lawaan','Lawaan',11.5662,122.7563), ('bolo','Bolo',11.5517,122.7271),
 ('lanot','Lanot',11.5385,122.7062), ('lonoy','Loñoy',11.5290,122.6962),
 ('ivisan','Ivisan',11.5217,122.6908), ('sigma','Sigma',11.4219,122.6664),
 ('dao','Dao',11.3937,122.6856), ('cuartero','Cuartero',11.3407,122.6694),
 ('dumarao','Dumarao',11.2654,122.6889), ('passi_city','Passi City',11.1078,122.6415),
 ('duenas','Dueñas',11.0675,122.6180), ('pototan','Pototan',10.9440,122.6350),
 ('zarraga','Zarraga',10.8240,122.6080), ('leganes','Leganes',10.7870,122.5890),
 ('jaro','Jaro',10.7370,122.5650), ('tagbak_terminal','Tagbak Terminal (Iloilo)',10.7700,122.5570),
 ('mambusao','Mambusao',11.4336,122.5982), ('altavas','Altavas',11.5350,122.4900),
 ('balete','Balete',11.5680,122.3850), ('banga','Banga',11.6380,122.3400),
 ('kalibo_terminal','Kalibo Terminal',11.7060,122.3650), ('sapian','Sapian',11.4943,122.6027),
 ('jamindan','Jamindan',11.4002,122.4983), ('tapaz','Tapaz',11.2613,122.5364),
 ('calinog','Calinog',11.1300,122.4900), ('loctugan','Loctugan',11.5660,122.7780),
 ('panitan','Panitan',11.4660,122.7725), ('pontevedra','Pontevedra',11.4812,122.8325),
 ('president_roxas','President Roxas',11.4310,122.9279), ('pilar','Pilar',11.4870,122.9963),
 ('balasan','Balasan',11.4700,123.0800), ('estancia_terminal','Estancia Terminal',11.4550,123.1510)
on conflict (code) do update set name=excluded.name, lat=excluded.lat, lng=excluded.lng;

insert into public.route_checkpoints (route_id,sequence,checkpoint_id,eta_offset_minutes,segment_minutes,dwell_buffer_minutes)
select v.route_id,v.seq,c.id,v.eta,v.segment,v.dwell
from (values
 ('iloilo_passi',0,'pueblo_terminal',0,0,0),('iloilo_passi',1,'lawaan',4,4,0),('iloilo_passi',2,'bolo',7,3,0),
 ('iloilo_passi',3,'lanot',11,4,0),('iloilo_passi',4,'lonoy',17,6,0),('iloilo_passi',5,'ivisan',23,6,0),
 ('iloilo_passi',6,'sigma',33,10,0),('iloilo_passi',7,'dao',43,10,0),('iloilo_passi',8,'cuartero',53,10,0),
 ('iloilo_passi',9,'dumarao',65,12,0),('iloilo_passi',10,'passi_city',83,18,8),('iloilo_passi',11,'duenas',98,7,0),
 ('iloilo_passi',12,'pototan',110,12,0),('iloilo_passi',13,'zarraga',125,15,0),('iloilo_passi',14,'leganes',133,8,0),
 ('iloilo_passi',15,'jaro',143,10,0),('iloilo_passi',16,'tagbak_terminal',150,7,0),
 ('kalibo_mambusao',0,'pueblo_terminal',0,0,0),('kalibo_mambusao',1,'lawaan',4,4,0),
 ('kalibo_mambusao',2,'bolo',7,3,0),('kalibo_mambusao',3,'lanot',11,4,0),('kalibo_mambusao',4,'lonoy',17,6,0),
 ('kalibo_mambusao',5,'ivisan',23,6,0),('kalibo_mambusao',6,'sigma',33,10,0),('kalibo_mambusao',7,'mambusao',45,12,0),
 ('kalibo_mambusao',8,'altavas',68,23,0),('kalibo_mambusao',9,'balete',83,15,0),('kalibo_mambusao',10,'banga',98,15,0),
 ('kalibo_mambusao',11,'kalibo_terminal',110,12,0),
 ('kalibo_sapian',0,'pueblo_terminal',0,0,0),('kalibo_sapian',1,'lawaan',4,4,0),('kalibo_sapian',2,'bolo',7,3,0),
 ('kalibo_sapian',3,'lanot',11,4,0),('kalibo_sapian',4,'lonoy',17,6,0),('kalibo_sapian',5,'ivisan',23,6,0),
 ('kalibo_sapian',6,'sapian',36,13,0),('kalibo_sapian',7,'altavas',54,18,0),('kalibo_sapian',8,'balete',69,15,0),
 ('kalibo_sapian',9,'banga',84,15,0),('kalibo_sapian',10,'kalibo_terminal',96,12,0),
 ('tapaz',0,'pueblo_terminal',0,0,0),('tapaz',1,'lawaan',4,4,0),('tapaz',2,'bolo',7,3,0),
 ('tapaz',3,'lanot',11,4,0),('tapaz',4,'lonoy',17,6,0),('tapaz',5,'ivisan',23,6,0),('tapaz',6,'sigma',33,10,0),
 ('tapaz',7,'mambusao',45,12,0),('tapaz',8,'jamindan',60,15,0),('tapaz',9,'tapaz',78,18,0),('tapaz',10,'calinog',95,17,0),
 ('estancia',0,'pueblo_terminal',0,0,0),('estancia',1,'lawaan',4,4,0),('estancia',2,'bolo',7,3,0),
 ('estancia',3,'lanot',11,4,0),('estancia',4,'loctugan',16,5,0),('estancia',5,'panitan',23,7,0),
 ('estancia',6,'pontevedra',35,12,0),('estancia',7,'president_roxas',48,13,0),('estancia',8,'pilar',63,15,0),
 ('estancia',9,'balasan',78,15,0),('estancia',10,'estancia_terminal',90,12,0)
) as v(route_id,seq,code,eta,segment,dwell)
join public.checkpoints c on c.code=v.code
on conflict (route_id,checkpoint_id) do update
set sequence=excluded.sequence, eta_offset_minutes=excluded.eta_offset_minutes,
    segment_minutes=excluded.segment_minutes, dwell_buffer_minutes=excluded.dwell_buffer_minutes;

-- ByahePanay / Ceres Liner Last-Trip Tracker
-- Run once in Supabase SQL Editor. Coordinates and travel offsets are planning estimates,
-- not operator-published schedules or surveyed roadside geofences.

create extension if not exists pgcrypto;

create table if not exists public.routes (
  id text primary key,
  name text not null,
  short_name text not null,
  destination text not null,
  origin_name text not null default 'Pueblo de Panay Terminal',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

create table if not exists public.route_checkpoints (
  route_id text not null references public.routes(id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  eta_offset_minutes integer not null check (eta_offset_minutes >= 0),
  segment_minutes integer not null default 0 check (segment_minutes >= 0),
  dwell_buffer_minutes integer not null default 0 check (dwell_buffer_minutes >= 0),
  primary key (route_id, checkpoint_id),
  unique (route_id, sequence)
);

create table if not exists public.buses (
  id uuid primary key default gen_random_uuid(),
  body_number text not null unique,
  plate_number text,
  bus_type text check (bus_type in ('ordinary', 'aircon')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  route_id text not null references public.routes(id),
  bus_id uuid references public.buses(id) on delete set null,
  bus_type text not null check (bus_type in ('ordinary', 'aircon')),
  departure_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'arrived', 'cancelled')),
  last_checkpoint_id uuid references public.checkpoints(id),
  last_checkpoint_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  confidence_status text not null default 'verified' check (confidence_status in ('scheduled', 'unverified', 'verified')),
  pending_checkpoint_id uuid references public.checkpoints(id),
  pending_reported_at timestamptz,
  route_locked boolean not null default false,
  route_candidate text references public.routes(id),
  rider_status text,
  rider_status_at timestamptz,
  delay_minutes integer not null default 0 check (delay_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_creator_sessions (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  spotter_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_rider_sessions (
  trip_id uuid not null references public.trips(id) on delete cascade,
  spotter_id uuid not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (trip_id, spotter_id)
);

create table if not exists public.sightings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints(id),
  spotter_id uuid not null,
  kind text not null check (kind in ('departure', 'roadside', 'rider_beacon')),
  lat double precision not null,
  lng double precision not null,
  distance_meters double precision not null default 0,
  implied_speed_kmh double precision,
  is_verified boolean not null default false,
  confidence_status text not null default 'unverified' check (confidence_status in ('unverified', 'verified')),
  rider_status text,
  created_at timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  verified_at timestamptz
);

create index if not exists route_checkpoints_route_sequence_idx on public.route_checkpoints(route_id, sequence);
create index if not exists trips_active_route_departure_idx on public.trips(route_id, departure_at desc) where status = 'active';
create index if not exists trips_updated_at_idx on public.trips(updated_at desc);
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

drop trigger if exists buses_set_updated_at on public.buses;
create trigger buses_set_updated_at before update on public.buses
for each row execute function public.set_updated_at();
drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at before update on public.trips
for each row execute function public.set_updated_at();

alter table public.routes enable row level security;
alter table public.checkpoints enable row level security;
alter table public.route_checkpoints enable row level security;
alter table public.buses enable row level security;
alter table public.trips enable row level security;
alter table public.sightings enable row level security;
alter table public.trip_rider_sessions enable row level security;
alter table public.trip_creator_sessions enable row level security;

drop policy if exists "public read routes" on public.routes;
create policy "public read routes" on public.routes for select to anon, authenticated using (is_active);
drop policy if exists "public read checkpoints" on public.checkpoints;
create policy "public read checkpoints" on public.checkpoints for select to anon, authenticated using (true);
drop policy if exists "public read route checkpoints" on public.route_checkpoints;
create policy "public read route checkpoints" on public.route_checkpoints for select to anon, authenticated using (true);
drop policy if exists "public read buses" on public.buses;
create policy "public read buses" on public.buses for select to anon, authenticated using (true);
drop policy if exists "public read trips" on public.trips;
create policy "public read trips" on public.trips for select to anon, authenticated using (status = 'active' or status = 'arrived');
drop policy if exists "public read sightings" on public.sightings;
create policy "public read verified sightings" on public.sightings
  for select to anon, authenticated using (is_verified);

-- Public roles are explicitly read-only. RLS then narrows which rows each can see.
revoke all on table public.routes, public.checkpoints, public.route_checkpoints, public.buses, public.trips
  from anon, authenticated;
grant select on table public.routes, public.checkpoints, public.route_checkpoints, public.buses, public.trips
  to anon, authenticated;
revoke all on table public.trip_creator_sessions, public.trip_rider_sessions from anon, authenticated;

-- Public Realtime can receive verified checkpoint metadata only. Keep spotter IDs,
-- raw GPS coordinates, and all mutation privileges unavailable to browser roles.
revoke all on table public.sightings from anon, authenticated;
grant select (id, trip_id, checkpoint_id, is_verified, confidence_status)
  on table public.sightings to anon, authenticated;

-- No anon/authenticated INSERT or UPDATE policies are intentionally created.
-- All mutations must go through the validated Next.js API using the server-only service role.
-- service_role bypasses RLS; never expose that key to a browser.

insert into public.routes (id, name, short_name, destination, origin_name) values
  ('iloilo_passi', 'Roxas City → Iloilo via Passi', 'Iloilo · Passi', 'Tagbak Terminal', 'Pueblo de Panay Terminal'),
  ('kalibo_mambusao', 'Roxas City → Kalibo via Mambusao', 'Kalibo · Mambusao', 'Kalibo Terminal', 'Pueblo de Panay Terminal'),
  ('kalibo_sapian', 'Roxas City → Kalibo via Sapian', 'Kalibo · Sapian', 'Kalibo Terminal', 'Pueblo de Panay Terminal'),
  ('tapaz', 'Roxas City → Tapaz / Calinog', 'Tapaz', 'Calinog', 'Pueblo de Panay Terminal'),
  ('estancia', 'Roxas City → Estancia', 'Estancia', 'Estancia Terminal', 'Pueblo de Panay Terminal')
on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, destination = excluded.destination;

insert into public.checkpoints (code, name, lat, lng) values
  ('pueblo_terminal', 'Pueblo de Panay Terminal', 11.55987, 122.74805),
  ('lawaan', 'Lawaan', 11.5662, 122.7563),
  ('bolo', 'Bolo', 11.5517, 122.7271),
  ('lanot', 'Lanot', 11.5385, 122.7062),
  ('lonoy', 'Loñoy', 11.5290, 122.6962),
  ('ivisan', 'Ivisan', 11.5217, 122.6908),
  ('sigma', 'Sigma', 11.4219, 122.6664),
  ('dao', 'Dao', 11.3937, 122.6856),
  ('cuartero', 'Cuartero', 11.3407, 122.6694),
  ('dumarao', 'Dumarao', 11.2654, 122.6889),
  ('passi_city', 'Passi City', 11.1078, 122.6415),
  ('duenas', 'Dueñas', 11.0675, 122.6180),
  ('pototan', 'Pototan', 10.9440, 122.6350),
  ('zarraga', 'Zarraga', 10.8240, 122.6080),
  ('leganes', 'Leganes', 10.7870, 122.5890),
  ('jaro', 'Jaro', 10.7370, 122.5650),
  ('tagbak_terminal', 'Tagbak Terminal (Iloilo)', 10.7700, 122.5570),
  ('mambusao', 'Mambusao', 11.4336, 122.5982),
  ('altavas', 'Altavas', 11.5350, 122.4900),
  ('balete', 'Balete', 11.5680, 122.3850),
  ('banga', 'Banga', 11.6380, 122.3400),
  ('kalibo_terminal', 'Kalibo Terminal', 11.7060, 122.3650),
  ('sapian', 'Sapian', 11.4943, 122.6027),
  ('jamindan', 'Jamindan', 11.4002, 122.4983),
  ('tapaz', 'Tapaz', 11.2613, 122.5364),
  ('calinog', 'Calinog', 11.1300, 122.4900),
  ('loctugan', 'Loctugan', 11.5660, 122.7780),
  ('panitan', 'Panitan', 11.4660, 122.7725),
  ('pontevedra', 'Pontevedra', 11.4812, 122.8325),
  ('president_roxas', 'President Roxas', 11.4310, 122.9279),
  ('pilar', 'Pilar', 11.4870, 122.9963),
  ('balasan', 'Balasan', 11.4700, 123.0800),
  ('estancia_terminal', 'Estancia Terminal', 11.4550, 123.1510)
on conflict (code) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng;

-- (route_id, sequence, checkpoint_code, cumulative_eta_minutes, physical_segment_minutes, dwell_buffer_minutes)
insert into public.route_checkpoints (route_id, sequence, checkpoint_id, eta_offset_minutes, segment_minutes, dwell_buffer_minutes)
select v.route_id, v.seq, c.id, v.eta, v.segment, v.dwell
from (values
  ('iloilo_passi',0,'pueblo_terminal',0,0,0), ('iloilo_passi',1,'lawaan',4,4,0),
  ('iloilo_passi',2,'bolo',7,3,0), ('iloilo_passi',3,'lanot',11,4,0),
  ('iloilo_passi',4,'lonoy',17,6,0), ('iloilo_passi',5,'ivisan',23,6,0),
  ('iloilo_passi',6,'sigma',33,10,0), ('iloilo_passi',7,'dao',43,10,0),
  ('iloilo_passi',8,'cuartero',53,10,0), ('iloilo_passi',9,'dumarao',65,12,0),
  ('iloilo_passi',10,'passi_city',83,18,8), ('iloilo_passi',11,'duenas',98,7,0),
  ('iloilo_passi',12,'pototan',110,12,0), ('iloilo_passi',13,'zarraga',125,15,0),
  ('iloilo_passi',14,'leganes',133,8,0), ('iloilo_passi',15,'jaro',143,10,0), ('iloilo_passi',16,'tagbak_terminal',150,7,0),

  ('kalibo_mambusao',0,'pueblo_terminal',0,0,0), ('kalibo_mambusao',1,'lawaan',4,4,0),
  ('kalibo_mambusao',2,'bolo',7,3,0), ('kalibo_mambusao',3,'lanot',11,4,0),
  ('kalibo_mambusao',4,'lonoy',17,6,0), ('kalibo_mambusao',5,'ivisan',23,6,0),
  ('kalibo_mambusao',6,'sigma',33,10,0), ('kalibo_mambusao',7,'mambusao',45,12,0),
  ('kalibo_mambusao',8,'altavas',68,23,0), ('kalibo_mambusao',9,'balete',83,15,0),
  ('kalibo_mambusao',10,'banga',98,15,0), ('kalibo_mambusao',11,'kalibo_terminal',110,12,0),

  ('kalibo_sapian',0,'pueblo_terminal',0,0,0), ('kalibo_sapian',1,'lawaan',4,4,0),
  ('kalibo_sapian',2,'bolo',7,3,0), ('kalibo_sapian',3,'lanot',11,4,0),
  ('kalibo_sapian',4,'lonoy',17,6,0), ('kalibo_sapian',5,'ivisan',23,6,0),
  ('kalibo_sapian',6,'sapian',36,13,0), ('kalibo_sapian',7,'altavas',54,18,0),
  ('kalibo_sapian',8,'balete',69,15,0), ('kalibo_sapian',9,'banga',84,15,0), ('kalibo_sapian',10,'kalibo_terminal',96,12,0),

  ('tapaz',0,'pueblo_terminal',0,0,0), ('tapaz',1,'lawaan',4,4,0),
  ('tapaz',2,'bolo',7,3,0), ('tapaz',3,'lanot',11,4,0),
  ('tapaz',4,'lonoy',17,6,0), ('tapaz',5,'ivisan',23,6,0),
  ('tapaz',6,'sigma',33,10,0), ('tapaz',7,'mambusao',45,12,0),
  ('tapaz',8,'jamindan',60,15,0), ('tapaz',9,'tapaz',78,18,0), ('tapaz',10,'calinog',95,17,0),

  ('estancia',0,'pueblo_terminal',0,0,0), ('estancia',1,'lawaan',4,4,0),
  ('estancia',2,'bolo',7,3,0), ('estancia',3,'lanot',11,4,0),
  ('estancia',4,'loctugan',16,5,0), ('estancia',5,'panitan',23,7,0),
  ('estancia',6,'pontevedra',35,12,0), ('estancia',7,'president_roxas',48,13,0),
  ('estancia',8,'pilar',63,15,0), ('estancia',9,'balasan',78,15,0), ('estancia',10,'estancia_terminal',90,12,0)
) as v(route_id, seq, code, eta, segment, dwell)
join public.checkpoints c on c.code = v.code
on conflict (route_id, checkpoint_id) do update
set sequence = excluded.sequence, eta_offset_minutes = excluded.eta_offset_minutes,
    segment_minutes = excluded.segment_minutes, dwell_buffer_minutes = excluded.dwell_buffer_minutes;

-- Realtime: safely add tables only if they are not already in the publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
      alter publication supabase_realtime add table public.trips;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sightings') then
      alter publication supabase_realtime add table public.sightings;
    end if;
  end if;
end $$;

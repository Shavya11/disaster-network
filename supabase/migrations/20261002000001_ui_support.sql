-- Human-friendly incident references (INC-2001) and place names for the control-room UI.

alter table public.incidents
  add column ref_no bigint generated always as identity (start with 2001) unique,
  add column place_name text;

-- Reverse-geocoding cache (~1 km grid) so each area is looked up once (Nominatim allows 1 request/s).
create table public.geocode_cache (
  grid_key    text primary key,
  place_name  text,
  created_at  timestamptz not null default now()
);
alter table public.geocode_cache enable row level security;

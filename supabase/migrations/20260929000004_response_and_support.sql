-- Response teams, assignments, resources, shelters, check-ins, road closures, settings.

create type public.team_type as enum ('FIRE', 'MEDICAL', 'POLICE', 'SEARCH_RESCUE', 'NDRF', 'VOLUNTEER');
create type public.team_status as enum ('AVAILABLE', 'ASSIGNED', 'OFF_DUTY');
create type public.assignment_status as enum
  ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED');
create type public.shelter_status as enum ('OPEN', 'FULL', 'CLOSED');
create type public.checkin_status as enum ('SAFE', 'NEED_HELP');

create table public.teams (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  type              public.team_type not null,
  status            public.team_status not null default 'AVAILABLE',
  base_location     extensions.geography(point, 4326) not null,
  current_location  extensions.geography(point, 4326),
  location_updated_at timestamptz,
  member_count      integer not null default 0 check (member_count >= 0),
  created_at        timestamptz not null default now()
);

alter table public.profiles add column team_id uuid references public.teams (id) on delete set null;

create table public.assignments (
  id               uuid primary key default gen_random_uuid(),
  incident_id      uuid not null references public.incidents (id) on delete cascade,
  team_id          uuid not null references public.teams (id) on delete cascade,
  assigned_by      uuid references public.profiles (id) on delete set null,
  status           public.assignment_status not null default 'ASSIGNED',
  instructions     text,
  sla_deadline     timestamptz not null,
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  en_route_at      timestamptz,
  on_scene_at      timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);
-- A team can hold only one open assignment at a time.
create unique index assignments_one_open_per_team on public.assignments (team_id)
  where status not in ('COMPLETED', 'CANCELLED');
create index assignments_incident_idx on public.assignments (incident_id);

create trigger assignments_touch_updated_at
  before update on public.assignments
  for each row execute function public.touch_updated_at();

create table public.resources (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  name        text not null,
  unit        text not null default 'units',
  quantity    integer not null check (quantity >= 0),
  available   integer not null check (available >= 0 and available <= quantity),
  depot_name  text not null,
  location    extensions.geography(point, 4326) not null,
  created_at  timestamptz not null default now()
);

create table public.resource_allocations (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null references public.resources (id) on delete cascade,
  incident_id   uuid not null references public.incidents (id) on delete cascade,
  quantity      integer not null check (quantity > 0),
  allocated_by  uuid references public.profiles (id) on delete set null,
  allocated_at  timestamptz not null default now(),
  released_at   timestamptz
);
create index resource_allocations_incident_idx on public.resource_allocations (incident_id);

create table public.shelters (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  kind               text not null default 'shelter', -- shelter | hospital | school | community_centre
  location           extensions.geography(point, 4326) not null,
  capacity           integer not null default 0 check (capacity >= 0),
  current_occupancy  integer not null default 0 check (current_occupancy >= 0),
  facilities         text[] not null default '{}',
  contact_phone      text,
  status             public.shelter_status not null default 'OPEN',
  osm_id             text unique,
  updated_at         timestamptz not null default now()
);
create index shelters_location_gix on public.shelters using gist (location);

create trigger shelters_touch_updated_at
  before update on public.shelters
  for each row execute function public.touch_updated_at();

create table public.safe_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  incident_id  uuid references public.incidents (id) on delete set null,
  status       public.checkin_status not null,
  location     extensions.geography(point, 4326),
  note         text,
  created_at   timestamptz not null default now()
);
create index safe_checkins_incident_idx on public.safe_checkins (incident_id, created_at desc);
create index safe_checkins_user_idx on public.safe_checkins (user_id, created_at desc);

create table public.blocked_roads (
  id          uuid primary key default gen_random_uuid(),
  segment     extensions.geography(linestring, 4326) not null,
  reason      text not null,
  incident_id uuid references public.incidents (id) on delete set null,
  marked_by   uuid references public.profiles (id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  cleared_at  timestamptz
);
create index blocked_roads_segment_gix on public.blocked_roads using gist (segment) where active;

-- Admin-editable configuration (thresholds, weights). Values override code defaults.
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table public.teams                enable row level security;
alter table public.assignments          enable row level security;
alter table public.resources            enable row level security;
alter table public.resource_allocations enable row level security;
alter table public.shelters             enable row level security;
alter table public.safe_checkins        enable row level security;
alter table public.blocked_roads        enable row level security;
alter table public.settings             enable row level security;

create function public.is_responder_or_staff()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_role() in ('RESPONDER', 'COORDINATOR', 'ADMIN'), false)
$$;

create policy teams_select on public.teams
  for select to authenticated using (true);

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    public.is_staff()
    or team_id = (select team_id from public.profiles where id = auth.uid())
  );

create policy resources_select on public.resources
  for select to authenticated using (public.is_responder_or_staff());

create policy resource_allocations_select on public.resource_allocations
  for select to authenticated using (public.is_responder_or_staff());

create policy shelters_select_public on public.shelters
  for select to anon, authenticated using (true);

create policy safe_checkins_select on public.safe_checkins
  for select to authenticated using (user_id = auth.uid() or public.is_responder_or_staff());

create policy blocked_roads_select_public on public.blocked_roads
  for select to anon, authenticated using (true);

create policy settings_select_staff on public.settings
  for select to authenticated using (public.is_staff());

alter publication supabase_realtime add table
  public.teams, public.assignments, public.shelters, public.safe_checkins, public.blocked_roads;

-- Initial schema: V1 tables, geospatial indexes, RLS, audit log.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.user_role as enum ('CITIZEN', 'RESPONDER', 'COORDINATOR', 'ADMIN');

create type public.hazard_type as enum (
  'EARTHQUAKE', 'FLOOD', 'CYCLONE', 'STORM', 'WILDFIRE', 'HEATWAVE', 'LANDSLIDE',
  'BUILDING_COLLAPSE', 'GAS_LEAK', 'MEDICAL', 'FIRE', 'ROAD_BLOCKAGE', 'OTHER'
);

create type public.incident_status as enum (
  'REPORTED', 'VERIFIED', 'ACTIVE', 'CONTAINED', 'RESOLVED', 'REJECTED'
);

create type public.severity_tier as enum ('INFO', 'WATCH', 'WARNING', 'EMERGENCY');

create type public.alert_channel as enum ('TELEGRAM', 'EMAIL', 'SMS', 'PUSH');

create type public.delivery_status as enum ('PENDING', 'SENT', 'FAILED', 'ACKNOWLEDGED');

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text,
  phone               text,
  role                public.user_role not null default 'CITIZEN',
  last_location       extensions.geography(point, 4326),
  location_updated_at timestamptz,
  alert_radius_m      integer not null default 10000 check (alert_radius_m between 500 and 200000),
  channels            public.alert_channel[] not null default '{EMAIL}',
  telegram_chat_id    text,
  language            text not null default 'en' check (language in ('en', 'hi')),
  created_at          timestamptz not null default now()
);

create table public.incidents (
  id              uuid primary key default gen_random_uuid(),
  hazard_type     public.hazard_type not null,
  title           text not null,
  description     text,
  status          public.incident_status not null default 'REPORTED',
  severity_score  numeric(5, 2) not null default 0 check (severity_score between 0 and 100),
  severity_tier   public.severity_tier not null default 'INFO',
  epicenter       extensions.geography(point, 4326) not null,
  affected_area   extensions.geography(polygon, 4326),
  report_count    integer not null default 0,
  signal_count    integer not null default 0,
  confidence      numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  verified_by     uuid references public.profiles (id) on delete set null,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

-- One row per event from a public feed (USGS, Open-Meteo, GDACS, ...).
create table public.raw_signals (
  id               bigint generated always as identity primary key,
  source           text not null,
  source_event_id  text not null,
  hazard_type      public.hazard_type not null,
  location         extensions.geography(point, 4326) not null,
  magnitude        numeric,
  title            text,
  occurred_at      timestamptz not null,
  payload          jsonb not null default '{}',
  incident_id      uuid references public.incidents (id) on delete set null,
  ingested_at      timestamptz not null default now(),
  unique (source, source_event_id)
);

create table public.reports (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  incident_id          uuid references public.incidents (id) on delete set null,
  hazard_type          public.hazard_type not null,
  location             extensions.geography(point, 4326) not null,
  description          text,
  photo_url            text,
  people_affected      integer check (people_affected >= 0),
  -- Generated on the device; makes offline re-sync idempotent.
  client_generated_id  uuid not null unique,
  reported_at          timestamptz not null,
  received_at          timestamptz not null default now()
);

create table public.alerts (
  id               uuid primary key default gen_random_uuid(),
  incident_id      uuid references public.incidents (id) on delete set null,
  tier             public.severity_tier not null,
  title            text not null,
  body             text not null,
  geofence         extensions.geography(polygon, 4326) not null,
  channels         public.alert_channel[] not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  recipient_count  integer not null default 0
);

create table public.deliveries (
  id               bigint generated always as identity primary key,
  alert_id         uuid not null references public.alerts (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  channel          public.alert_channel not null,
  status           public.delivery_status not null default 'PENDING',
  attempts         integer not null default 0,
  error            text,
  sent_at          timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (alert_id, user_id, channel)
);

-- Mock SMS gateway: messages are written here instead of being sent.
create table public.sms_outbox (
  id          bigint generated always as identity primary key,
  to_phone    text not null,
  body        text not null,
  alert_id    uuid references public.alerts (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.feed_runs (
  id           bigint generated always as identity primary key,
  source       text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  fetched      integer not null default 0,
  inserted     integer not null default 0,
  error        text
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index profiles_last_location_gix on public.profiles using gist (last_location);
create index incidents_epicenter_gix on public.incidents using gist (epicenter);
create index incidents_status_created_idx on public.incidents (status, created_at desc);
create index raw_signals_location_gix on public.raw_signals using gist (location);
create index raw_signals_occurred_idx on public.raw_signals (occurred_at desc);
create index reports_location_gix on public.reports using gist (location);
create index reports_incident_idx on public.reports (incident_id);
create index reports_user_idx on public.reports (user_id);
create index deliveries_alert_idx on public.deliveries (alert_id);
create index deliveries_user_idx on public.deliveries (user_id);
create index feed_runs_source_idx on public.feed_runs (source, started_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------- triggers
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger incidents_touch_updated_at
  before update on public.incidents
  for each row execute function public.touch_updated_at();

-- Audit log is append-only for everyone, including the service role (NFR-9).
create function public.audit_log_block_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_block_changes();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_block_changes();

-- ---------------------------------------------------------------- RLS
-- The backend connects with elevated privileges and bypasses RLS.
-- These policies govern direct browser access (Supabase JS client + Realtime).

create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_staff()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_role() in ('COORDINATOR', 'ADMIN'), false)
$$;

alter table public.profiles    enable row level security;
alter table public.incidents   enable row level security;
alter table public.raw_signals enable row level security;
alter table public.reports     enable row level security;
alter table public.alerts      enable row level security;
alter table public.deliveries  enable row level security;
alter table public.sms_outbox  enable row level security;
alter table public.feed_runs   enable row level security;
alter table public.audit_log   enable row level security;

-- profiles: users see and edit themselves; staff see everyone.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Users may never change their own role or location directly.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, alert_radius_m, channels, telegram_chat_id, language)
  on public.profiles to authenticated;

-- incidents and raw signals: public map data.
create policy incidents_select_public on public.incidents
  for select to anon, authenticated
  using (status <> 'REJECTED' or public.is_staff());

create policy raw_signals_select_public on public.raw_signals
  for select to anon, authenticated
  using (true);

-- reports: citizens see their own; staff and responders see all.
create policy reports_select on public.reports
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_role() in ('RESPONDER', 'COORDINATOR', 'ADMIN')
  );

-- alerts: staff see all; others see alerts delivered to them.
create policy alerts_select on public.alerts
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.deliveries d
      where d.alert_id = alerts.id and d.user_id = auth.uid()
    )
  );

create policy deliveries_select on public.deliveries
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy sms_outbox_select_staff on public.sms_outbox
  for select to authenticated using (public.is_staff());

create policy feed_runs_select_staff on public.feed_runs
  for select to authenticated using (public.is_staff());

create policy audit_log_select_admin on public.audit_log
  for select to authenticated using (public.current_user_role() = 'ADMIN');

-- No insert/update/delete policies: all writes go through the backend API.

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table
  public.incidents, public.reports, public.alerts, public.deliveries;

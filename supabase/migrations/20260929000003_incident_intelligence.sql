alter table public.incidents
  add column severity_breakdown jsonb,
  add column alert_permission public.severity_tier not null default 'INFO',
  add column tier_override public.severity_tier,
  add column origin text not null default 'feed' check (origin in ('feed', 'citizen')),
  add column last_activity_at timestamptz not null default now();

create index incidents_open_idx on public.incidents (hazard_type, last_activity_at desc)
  where status in ('REPORTED', 'VERIFIED', 'ACTIVE');

-- Citizen report photos: public read, users upload only into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy report_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

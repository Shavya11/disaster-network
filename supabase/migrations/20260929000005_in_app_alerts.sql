-- In-app inbox channel. External channels (email, WhatsApp, Telegram, SMS) plug in later.
alter type public.alert_channel add value if not exists 'IN_APP';

alter table public.alerts add column skipped_duplicates integer not null default 0;

create index alerts_incident_idx on public.alerts (incident_id, created_at desc);
create index deliveries_user_created_idx on public.deliveries (user_id, created_at desc);

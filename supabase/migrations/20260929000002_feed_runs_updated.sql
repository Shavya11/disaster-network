alter table public.feed_runs add column updated integer not null default 0;
create index raw_signals_source_occurred_idx on public.raw_signals (source, occurred_at desc);

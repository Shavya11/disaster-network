import type { AdminUser, Analytics, AuditEntry, FeedHealth, MetricsReport, SimulationResult, UserRole } from '@dn/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CircleCheck, CircleDashed, CircleX, CloudRain, Globe, Play, RefreshCw, RotateCcw, Satellite, Save, Search, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Chip, Empty, ErrorNote, SectionCard, Spinner } from '../components/ui';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { C, ROLE_LABEL, ago, num, when } from '../lib/format';

const FEEDS: Record<string, { name: string; desc: string; icon: LucideIcon }> = {
  usgs: { name: 'USGS', desc: 'Global earthquakes, updated every minute', icon: Activity },
  'open-meteo': { name: 'Open-Meteo', desc: 'Rainfall, wind, temperature & forecasts for Indian cities', icon: CloudRain },
  gdacs: { name: 'GDACS', desc: 'Global multi-hazard alerts, severity pre-assigned', icon: Globe },
  firms: { name: 'NASA FIRMS', desc: 'Satellite-detected active fires', icon: Satellite },
};

export function Admin() {
  return (
    <section className="view view-scroll">
      <FeedHealthCard />
      <AlertsChart />
      <Metrics />
      <Simulator />
      <Thresholds />
      <Users />
      <AuditLog />
    </section>
  );
}

function feedState(f: FeedHealth): { label: string; color: string } {
  if (!f.last_run_at) return { label: 'NOT RUN', color: C.faint };
  if (f.last_run_ok === false) return { label: 'FAILING', color: C.critical };
  const age = Date.now() - new Date(f.last_success_at ?? f.last_run_at).getTime();
  return age > 30 * 60_000 ? { label: 'DELAYED', color: C.warning } : { label: 'HEALTHY', color: C.nominal };
}

function FeedHealthCard() {
  const qc = useQueryClient();
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: () => api.get<FeedHealth[]>('/admin/feeds/health'), refetchInterval: 60_000 });
  const poll = useMutation({
    mutationFn: (source: string) => api.post<{ ok: boolean; fetched: number; inserted: number; error?: string }>(`/admin/feeds/${source}/poll`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['feeds'] });
      void qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
  return (
    <SectionCard title="DATA SOURCE HEALTH" extra={<span className="dim small">feeds refresh every 10 minutes</span>}>
      {feeds.isLoading && <Empty><Spinner /> Loading…</Empty>}
      <ErrorNote error={feeds.error ? errorText(feeds.error) : null} />
      <div className="source-grid">
        {feeds.data?.map((f) => {
          const meta = FEEDS[f.source] ?? { name: f.source, desc: '', icon: Activity };
          const s = feedState(f);
          const polling = poll.isPending && poll.variables === f.source;
          return (
            <div key={f.source} className="card source-card">
              <div className="source-card-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><meta.icon size={16} color={C.primary} /><span className="source-card-name">{meta.name}</span></div>
                <Chip color={s.color}>{s.label}</Chip>
              </div>
              <p className="source-card-desc">{meta.desc}</p>
              {f.last_error && f.last_run_ok === false && <p className="small" style={{ color: C.critical, margin: '0 0 8px' }}>{f.last_error}</p>}
              <div className="source-card-foot">
                <span>{ago(f.last_success_at)}</span>
                <span>{f.success_rate_24h == null ? '—' : `${Math.round(f.success_rate_24h)}% ok`} · {num(f.new_signals_24h)} new / 24h</span>
                <button className="icon-btn" title="Poll now" aria-label={`Poll ${meta.name} now`} disabled={polling} onClick={() => poll.mutate(f.source)}>
                  <RefreshCw size={13} className={polling ? 'spin' : undefined} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {poll.data && <div className="small dim" style={{ marginTop: 8 }}>Last poll: {poll.data.ok ? `${poll.data.fetched} fetched, ${poll.data.inserted} new` : `failed — ${poll.data.error}`}</div>}
      <ErrorNote error={poll.error ? errorText(poll.error) : null} />
    </SectionCard>
  );
}

function AlertsChart() {
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: () => api.get<Analytics>('/admin/analytics?days=30'), refetchInterval: 60_000 });
  const pts = analytics.data?.alerts.per_hour ?? [];
  // Draw at the container's real width so labels stay at their natural size.
  const [W, setW] = useState(560);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [analytics.isLoading]);
  const H = 170, L = 28, R = W - 14, T = 10, B = H - 24;
  const max = Math.max(1, ...pts.map((p) => p.count));
  const x = (i: number) => L + (i * (R - L)) / Math.max(1, pts.length - 1);
  const y = (v: number) => B - (v / max) * (B - T);
  const ticks = [...new Set([max, Math.round(max / 2), 0])];
  const a = analytics.data;
  return (
    <SectionCard
      title="ALERTS SENT — LAST 24 HOURS"
      extra={a && <span className="dim small">{num(a.alerts.total)} alerts · {num(a.alerts.people_alerted)} people · {a.alerts.acknowledged_pct ?? '—'}% acknowledged (30 d)</span>}
    >
      {analytics.isLoading ? (
        <Empty><Spinner /> Loading…</Empty>
      ) : (
        <div ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Alerts sent per hour over the last 24 hours">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} y1={y(t)} x2={R} y2={y(t)} stroke={C.line} strokeDasharray="3,3" />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="chart-axis-label">{t}</text>
            </g>
          ))}
          {pts.map((p, i) =>
            i % (W < 600 ? 6 : 3) === 0 || i === pts.length - 1 ? (
              <text key={p.hour} x={x(i)} y={H - 5} textAnchor="middle" className="chart-axis-label">{p.hour}</text>
            ) : null,
          )}
          {pts.length > 1 && (
            <>
              <polygon points={`${x(0)},${B} ${pts.map((p, i) => `${x(i)},${y(p.count)}`).join(' ')} ${x(pts.length - 1)},${B}`} fill="rgba(255,122,41,0.10)" />
              <polyline points={pts.map((p, i) => `${x(i)},${y(p.count)}`).join(' ')} fill="none" stroke={C.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {pts.map((p, i) => (
            <g key={p.hour}>
              <circle cx={x(i)} cy={y(p.count)} r={7} fill="transparent" className="chart-hit"><title>{`${p.hour} — ${p.count} alert${p.count === 1 ? '' : 's'}`}</title></circle>
              {p.count > 0 && <circle cx={x(i)} cy={y(p.count)} r={2.4} fill={C.primary} />}
            </g>
          ))}
        </svg>
        </div>
      )}
    </SectionCard>
  );
}

function Metrics() {
  const m = useQuery({ queryKey: ['metrics'], queryFn: () => api.get<MetricsReport>('/admin/metrics') });
  // Live values win over an older benchmark of the same metric.
  const live = m.data?.live ?? [];
  const rows = [...(m.data?.measured?.results ?? []).filter((r) => !live.some((l) => l.id === r.id)), ...live].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return (
    <SectionCard
      title="SUCCESS METRICS"
      extra={m.data?.measured && <span className="dim small">benchmarks measured {when(m.data.measured.measured_at)} · {m.data.measured.environment}</span>}
    >
      {m.isLoading && <Empty><Spinner /> Loading…</Empty>}
      {rows.map((r) => {
        const col = r.pass === null ? C.faint : r.pass ? C.nominal : C.critical;
        const Icon = r.pass === null ? CircleDashed : r.pass ? CircleCheck : CircleX;
        return (
          <div key={`${r.id}-${r.label}`} className="metric-row">
            <span className="metric-label"><span className="mono faint">{r.id}</span> {r.label} <span className="metric-target">({r.target})</span></span>
            <span className="metric-actual" style={{ color: col }}><Icon size={13} />{r.value}</span>
          </div>
        );
      })}
    </SectionCard>
  );
}

const SCENARIOS = [
  { key: 'surat-flood', label: 'Surat flood (demo story)' },
  { key: 'mumbai-flood', label: 'Mumbai flood' },
  { key: 'delhi-earthquake', label: 'Delhi earthquake' },
  { key: 'building-collapse', label: 'Building collapse' },
];

function Simulator() {
  const qc = useQueryClient();
  const [scenario, setScenario] = useState('surat-flood');
  const invalidate = () => {
    for (const k of ['incidents', 'analytics', 'teams', 'roads', 'shelters', 'audit']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const run = useMutation({ mutationFn: () => api.post<SimulationResult>('/admin/simulate', { scenario }), onSuccess: invalidate });
  const clear = useMutation({ mutationFn: () => api.del<unknown>('/admin/simulate'), onSuccess: invalidate });
  return (
    <div className="card sim-card">
      <div>
        <span className="section-title">SCENARIO SIMULATOR</span>
        <p className="dim small" style={{ margin: '6px 0 0', maxWidth: 520, lineHeight: 1.5 }}>
          Injects a scripted disaster — feed signals and citizen reports — and runs it through the real pipeline: correlation, severity scoring and the incident queue.
          Then verify, alert and dispatch from the Coordinator Console. Simulated data is labelled and can be removed.
        </p>
        {run.data && (
          <div className="sim-status" style={{ display: 'flex' }}>
            <CircleCheck size={13} />Created {run.data.signals_created} signals, {run.data.reports_created} reports → {run.data.incident_ids.length} incident{run.data.incident_ids.length === 1 ? '' : 's'}. Open the Coordinator Console.
          </div>
        )}
        {clear.isSuccess && <div className="sim-status" style={{ display: 'flex' }}>Simulated data removed.</div>}
        <ErrorNote error={run.error ? errorText(run.error) : clear.error ? errorText(clear.error) : null} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="field" style={{ width: 'auto' }} value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
          {SCENARIOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button className="sim-btn" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? <Spinner /> : <Play size={14} />}Run Simulation</button>
        <button className="cycle-btn" disabled={clear.isPending} onClick={() => confirm('Remove all simulated incidents, reports and signals?') && clear.mutate()}>
          {clear.isPending ? <Spinner size={12} /> : <Trash2 size={12} />}Clear
        </button>
      </div>
    </div>
  );
}

interface SettingRow<T> { value: T; default: T; overridden: boolean; updated_at: string | null; updated_by: string | null; equivalent_text_reports?: number }
interface Settings {
  weather_thresholds: SettingRow<{ heavyRainMm: number; galeGustKmh: number; heatwaveMaxC: number }>;
  incident_rules: SettingRow<{ earthquakeMinMagnitude: number }>;
  alert_policy: SettingRow<{ watchConfidence: number }>;
}

/** Text-only citizen reports needed to reach a confidence (noisy-OR, 0.3 each — same rule as the API). */
const reportsFor = (c: number) => {
  let n = 1;
  while (1 - 0.7 ** n < c && n < 50) n++;
  return n;
};

function ThresholdRow({ label, value, min, max, step = 1, v, set, def }: { label: string; value: string; min: number; max: number; step?: number; v: number; set: (n: number) => void; def: number }) {
  return (
    <div className="threshold-row">
      <div className="threshold-top">
        <span className="threshold-label">{label} <span className="faint small">(default {def})</span></span>
        <span className="threshold-value">{value}</span>
      </div>
      <input type="range" className="threshold-slider" min={min} max={max} step={step} value={v} onChange={(e) => set(+e.target.value)} aria-label={label} />
    </div>
  );
}

function Thresholds() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/admin/settings') });
  const [w, setW] = useState<Settings['weather_thresholds']['value'] | null>(null);
  const [mag, setMag] = useState<number | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  useEffect(() => {
    if (!s.data) return;
    setW(s.data.weather_thresholds.value);
    setMag(s.data.incident_rules.value.earthquakeMinMagnitude);
    setConf(s.data.alert_policy.value.watchConfidence);
  }, [s.data]);

  const save = useMutation({
    mutationFn: async () => {
      const d = s.data!;
      const jobs: Promise<unknown>[] = [];
      if (JSON.stringify(w) !== JSON.stringify(d.weather_thresholds.value)) jobs.push(api.put('/admin/settings/weather_thresholds', w));
      if (mag !== d.incident_rules.value.earthquakeMinMagnitude) jobs.push(api.put('/admin/settings/incident_rules', { earthquakeMinMagnitude: mag }));
      if (conf !== d.alert_policy.value.watchConfidence) jobs.push(api.put('/admin/settings/alert_policy', { watchConfidence: conf }));
      await Promise.all(jobs);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
  const reset = useMutation({
    mutationFn: () => Promise.all(['weather_thresholds', 'incident_rules', 'alert_policy'].map((k) => api.del(`/admin/settings/${k}`))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (!s.data || !w || mag == null || conf == null) return <SectionCard title="EDITABLE HAZARD THRESHOLDS"><Empty><Spinner /> Loading…</Empty></SectionCard>;
  const dirty =
    JSON.stringify(w) !== JSON.stringify(s.data.weather_thresholds.value) ||
    mag !== s.data.incident_rules.value.earthquakeMinMagnitude ||
    conf !== s.data.alert_policy.value.watchConfidence;
  const changed = [s.data.weather_thresholds, s.data.incident_rules, s.data.alert_policy].filter((x) => x.overridden && x.updated_at).sort((a, b) => b.updated_at!.localeCompare(a.updated_at!))[0];


  return (
    <SectionCard
      title="EDITABLE HAZARD THRESHOLDS"
      extra={<span className="dim small">{changed ? `last changed by ${changed.updated_by ?? 'admin'} ${ago(changed.updated_at)}` : 'using defaults'}</span>}
    >
      <ThresholdRow label="Flood rainfall threshold" value={`${w.heavyRainMm} mm / 24h`} min={40} max={250} v={w.heavyRainMm} set={(n) => setW({ ...w, heavyRainMm: n })} def={s.data.weather_thresholds.default.heavyRainMm} />
      <ThresholdRow label="Earthquake magnitude threshold" value={`M ${mag.toFixed(1)}`} min={2.5} max={8} step={0.1} v={mag} set={setMag} def={s.data.incident_rules.default.earthquakeMinMagnitude} />
      <ThresholdRow label="Cyclone / gale wind-gust threshold" value={`${w.galeGustKmh} km/h`} min={40} max={150} v={w.galeGustKmh} set={(n) => setW({ ...w, galeGustKmh: n })} def={s.data.weather_thresholds.default.galeGustKmh} />
      <ThresholdRow label="Heatwave max temperature" value={`${w.heatwaveMaxC} °C`} min={35} max={50} v={w.heatwaveMaxC} set={(n) => setW({ ...w, heatwaveMaxC: n })} def={s.data.weather_thresholds.default.heatwaveMaxC} />
      <ThresholdRow label="Citizen corroboration for a WATCH alert" value={`${Math.round(conf * 100)}% ≈ ${reportsFor(conf)} reports`} min={0.3} max={0.99} step={0.01} v={conf} set={setConf} def={s.data.alert_policy.default.watchConfidence} />
      <ErrorNote error={save.error ? errorText(save.error) : null} />
      <div className="action-row" style={{ marginTop: 12, maxWidth: 360 }}>
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner /> : <Save size={14} />}Save &amp; rescore</button>
        <button className="btn btn-reject" disabled={reset.isPending} onClick={() => reset.mutate()}><RotateCcw size={13} />Defaults</button>
      </div>
    </SectionCard>
  );
}

function Users() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const users = useQuery({ queryKey: ['users', query], queryFn: () => api.get<AdminUser[]>(`/admin/users${qs({ q: query, limit: 50 })}`) });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => api.patch(`/admin/users/${id}/role`, { role }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  return (
    <SectionCard
      title="USERS & ROLES"
      extra={
        <label className="search">
          <Search size={13} />
          <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      }
    >
      <ErrorNote error={setRole.error ? errorText(setRole.error) : null} />
      <div style={{ overflowX: 'auto' }}>
        <table className="user-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last active</th></tr></thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="u-name">{u.full_name ?? '—'}</td>
                <td>{u.email}</td>
                <td>
                  {u.id === profile?.id ? (
                    <span className="role-tag">{ROLE_LABEL[u.role]} (you)</span>
                  ) : (
                    <select className="role-select" value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as UserRole })} aria-label={`Role for ${u.full_name ?? u.email}`}>
                      {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </td>
                <td>{ago(u.last_sign_in_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <Empty><Spinner /> Loading…</Empty>}
      </div>
    </SectionCard>
  );
}

function auditText(e: AuditEntry): string {
  const verb = e.action.toLowerCase().replace(/_/g, ' ');
  const after = (e.after ?? {}) as Record<string, unknown>;
  const label = (after.reference ?? after.title ?? after.name ?? (e.entity_id ? e.entity_id.slice(0, 8) : '')) as string;
  return `${e.actor_name ?? 'System'} · ${verb} · ${e.entity_type}${label ? ` ${label}` : ''}`;
}

function AuditLog() {
  const audit = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => api.get<AuditEntry[]>(`/admin/audit${qs({ before_id: pageParam, limit: 30 })}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 30 ? last.at(-1)!.id : undefined),
  });
  const rows = audit.data?.pages.flat() ?? [];
  return (
    <SectionCard title={<>AUDIT LOG <span className="dim" style={{ fontWeight: 400, letterSpacing: 0 }}>— append-only, cannot be edited or deleted</span></>}>
      {audit.isLoading && <Empty><Spinner /> Loading…</Empty>}
      <ErrorNote error={audit.error ? errorText(audit.error) : null} />
      {rows.map((e) => (
        <div key={e.id} className="log-line">
          <span className="mono faint">{when(e.at)}</span>
          <span className="mono ink">{auditText(e)}</span>
        </div>
      ))}
      {audit.hasNextPage && (
        <button className="cycle-btn" style={{ marginTop: 10 }} disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
          {audit.isFetchingNextPage ? <Spinner size={12} /> : null}Load older entries
        </button>
      )}
    </SectionCard>
  );
}

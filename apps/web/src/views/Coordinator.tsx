import type { Analytics, BlockedRoad, GeoJSONPolygon, Incident, Profile, SeverityTier, Shelter, Team } from '@dn/shared';
import { useQuery } from '@tanstack/react-query';
import { Send, TriangleAlert, Users, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IncidentDetail } from '../components/IncidentDetail';
import { MapView } from '../components/MapView';
import { Empty, Kpi, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { C, HAZARD_ICON, TIER_COLOR, displayStatus, num } from '../lib/format';
import { useRealtime } from '../lib/realtime';

interface Toast {
  key: number;
  id: string;
  ref: string;
  title: string;
  tier: SeverityTier;
  show: boolean;
}

const isOpen = (i: Incident) => i.status !== 'RESOLVED' && i.status !== 'REJECTED';

export function Coordinator({ profile }: { profile: Profile }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [draft, setDraft] = useState<GeoJSONPolygon | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastKey = useRef(0);

  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api.get<Incident[]>('/incidents?limit=300'), refetchInterval: 120_000 });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/teams') });
  const shelters = useQuery({ queryKey: ['shelters'], queryFn: () => api.get<Shelter[]>('/shelters') });
  const roads = useQuery({ queryKey: ['roads'], queryFn: () => api.get<BlockedRoad[]>('/roads/blocked') });
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: () => api.get<Analytics>('/admin/analytics?days=30'), refetchInterval: 60_000 });

  useRealtime(
    {
      incidents: ['incidents', 'incident', 'analytics'],
      reports: ['incidents', 'timeline'],
      alerts: ['alerts', 'analytics', 'timeline'],
      deliveries: ['alerts', 'analytics'],
      teams: ['teams', 'teams-near'],
      assignments: ['assignments', 'teams', 'timeline'],
      shelters: ['shelters'],
      blocked_roads: ['roads', 'timeline'],
      safe_checkins: ['checkins'],
    },
    (c) => {
      if (c.table !== 'incidents' || c.eventType !== 'INSERT') return;
      const key = ++toastKey.current;
      const t: Toast = {
        key,
        id: String(c.new.id),
        ref: `INC-${c.new.ref_no}`,
        title: String(c.new.title ?? 'New incident'),
        tier: (c.new.severity_tier as SeverityTier) ?? 'INFO',
        show: false,
      };
      setToasts((ts) => [t, ...ts].slice(0, 3));
      setTimeout(() => setToasts((ts) => ts.map((x) => (x.key === key ? { ...x, show: true } : x))), 30);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), 7000);
    },
  );

  const all = incidents.data ?? [];
  const list = useMemo(() => (filter === 'open' ? all.filter(isOpen) : all), [all, filter]);
  const selected = all.find((i) => i.id === selectedId) ?? null;

  // Select the most urgent open incident once data arrives.
  useEffect(() => {
    if (!selectedId && list.length) setSelectedId(list[0]!.id);
  }, [list, selectedId]);
  useEffect(() => setDraft(null), [selectedId]);

  const open = all.filter(isOpen);
  const counts = { UNVERIFIED: 0, MONITORING: 0, VERIFIED: 0 } as Record<string, number>;
  for (const i of open) counts[displayStatus(i)] = (counts[displayStatus(i)] ?? 0) + 1;
  const a = analytics.data?.alerts;
  const v2a = a?.median_verify_to_alert_sec;

  const fitPoints = useMemo(() => open.map((i) => i.epicenter), [incidents.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="view">
      <div className="kpi-grid">
        <Kpi label="Active Incidents" icon={TriangleAlert} color={C.critical} value={incidents.isLoading ? '—' : open.length}
          sub={`${counts.UNVERIFIED} unverified · ${counts.VERIFIED} verified · ${counts.MONITORING} monitoring`} />
        <Kpi label="Verify → Alert (median)" icon={Zap} color={C.primary} value={v2a == null ? '—' : v2a < 120 ? `${Math.round(v2a)}s` : `${Math.round(v2a / 60)}m`} sub="target: under 30 seconds" />
        <Kpi label="Delivery Rate" icon={Send} color={C.nominal} value={a?.delivery_rate_pct == null ? '—' : `${a.delivery_rate_pct}%`} sub="target: above 95%" />
        <Kpi label="People Alerted Today" icon={Users} color={C.warning} value={a ? num(a.people_alerted_today) : '—'} sub={a ? `${num(a.people_alerted)} in the last 30 days` : 'loading…'} />
      </div>

      <div className="console">
        <div className="console-col">
          <div className="card">
            <div className="panel-head">
              <span className="section-title">INCIDENT QUEUE</span>
              <div className="seg">
                <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open {open.length}</button>
                <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All {all.length}</button>
              </div>
            </div>
            <div className="queue-list">
              {incidents.isLoading && <Empty><Spinner /> Loading incidents…</Empty>}
              {incidents.error && <Empty>Could not load incidents. {String((incidents.error as Error).message)}</Empty>}
              {!incidents.isLoading && list.length === 0 && <Empty>No open incidents. The feeds are being watched.</Empty>}
              {list.map((i) => {
                const Icon = HAZARD_ICON[i.hazard_type];
                const st = displayStatus(i);
                const color = st === 'RESOLVED' || st === 'DISMISSED' ? C.faint : TIER_COLOR[i.severity_tier];
                return (
                  <button key={i.id} className={`queue-row${i.id === selectedId ? ' selected' : ''}`} style={{ borderLeft: `3px solid ${color}` }} onClick={() => setSelectedId(i.id)}>
                    <Icon size={16} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div className="queue-row-body">
                      <div className="queue-row-top"><span className="queue-row-id">{i.reference}</span><span className="queue-row-id">{Math.round(i.severity_score)}</span></div>
                      <div className="queue-row-title">{i.title}</div>
                      <div className="queue-row-meta">
                        <StatusBadge status={st} />
                        {i.place_name && <span className="mini-tag">{i.place_name.split(',')[0]}</span>}
                        {i.report_count > 1 && <span className="mini-tag">{i.report_count} reports</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="console-col">
          <div className="card">
            <div className="panel-head"><span className="section-title">LIVE MAP</span><span className="dim small">India · Gujarat pilot region</span></div>
            <MapView
              incidents={list}
              teams={teams.data}
              shelters={shelters.data}
              roads={roads.data}
              selectedId={selectedId}
              onSelect={setSelectedId}
              area={draft ?? selected?.affected_area ?? null}
              areaColor={draft ? C.primary : selected ? TIER_COLOR[selected.severity_tier] : undefined}
              fitKey={incidents.isSuccess ? 'loaded' : undefined}
              fitPoints={fitPoints}
              showLayerToggles
              hint="drag to pan · right-drag to tilt · click a beacon"
            >
              <div className="notify-stack">
                {toasts.map((t) => (
                  <div key={t.key} className={`notify-card${t.show ? ' show' : ''}`} style={{ borderLeftColor: TIER_COLOR[t.tier] }} onClick={() => setSelectedId(t.id)}>
                    <TriangleAlert size={14} color={TIER_COLOR[t.tier]} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div className="min-w-0">
                      <div className="notify-card-title">{t.title}</div>
                      <div className="notify-card-sub">New incident · {t.ref}</div>
                    </div>
                  </div>
                ))}
              </div>
            </MapView>
            <div className="map-legend">
              {(['EMERGENCY', 'WARNING', 'WATCH', 'INFO'] as const).map((t) => (
                <span key={t} className="legend-item"><span className="legend-dot" style={{ background: TIER_COLOR[t] }} />{t === 'INFO' ? 'Advisory' : t[0] + t.slice(1).toLowerCase()}</span>
              ))}
              <span className="legend-item"><span className="legend-diamond" />Responder</span>
              <span className="legend-item"><span className="legend-square" />Shelter</span>
              <span className="legend-item"><span className="legend-line" />Blocked road</span>
            </div>
          </div>
        </div>

        <div className="console-col">
          <div className="card">
            <div className="panel-head"><span className="section-title">INCIDENT DETAIL</span>{selected && <span className="queue-row-id">{selected.reference}</span>}</div>
            {selected ? (
              <IncidentDetail key={selected.id} incident={selected} profile={profile} onDraftArea={setDraft} />
            ) : (
              <Empty>Select an incident from the queue or the map.</Empty>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

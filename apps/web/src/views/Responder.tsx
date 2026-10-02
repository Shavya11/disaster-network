import type { Assignment, BlockedRoad, LatLon, Profile, RouteResult, Team } from '@dn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Clock, MapPin, Navigation, Route as RouteIcon, Timer, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MapView } from '../components/MapView';
import { Chip, Empty, ErrorNote, Kpi, Spinner, TierBadge } from '../components/ui';
import { api, errorText } from '../lib/api';
import { C, HAZARD_ICON, TASK_COLOR, TASK_LABEL, TASK_NEXT, TIER_COLOR, ago, when } from '../lib/format';
import { useRealtime } from '../lib/realtime';

const OPEN = ['ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE'];

/** While the team is on the move, share the device position every ~30 s. */
function useShareLocation(team: Team | undefined, active: boolean) {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (!team || !active || !navigator.geolocation) return;
    let latest: LatLon | null = null;
    const watch = navigator.geolocation.watchPosition((p) => (latest = { lat: p.coords.latitude, lon: p.coords.longitude }), () => undefined, { enableHighAccuracy: true });
    const send = () => latest && api.put(`/teams/${team.id}/location`, latest).then(() => setLast(new Date().toISOString())).catch(() => undefined);
    const first = setTimeout(send, 3000);
    const t = setInterval(send, 30_000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(first);
      clearInterval(t);
    };
  }, [team, active]);
  return last;
}

export function Responder({ profile }: { profile: Profile }) {
  const team = useQuery({ queryKey: ['teams', 'mine'], queryFn: () => api.get<Team | null>('/teams/mine') });
  const tasks = useQuery({ queryKey: ['assignments', 'mine'], queryFn: () => api.get<Assignment[]>('/assignments/mine'), refetchInterval: 60_000 });
  const roads = useQuery({ queryKey: ['roads'], queryFn: () => api.get<BlockedRoad[]>('/roads/blocked') });
  useRealtime({ assignments: ['assignments'], teams: ['teams'], blocked_roads: ['roads'] });

  const all = tasks.data ?? [];
  const open = all.filter((a) => OPEN.includes(a.status));
  const doneToday = all.filter((a) => a.completed_at && new Date(a.completed_at).toDateString() === new Date().toDateString());
  const moving = open.some((a) => a.status === 'EN_ROUTE');
  const shared = useShareLocation(team.data ?? undefined, moving);
  const scene = all.filter((a) => a.on_scene_at).map((a) => (new Date(a.on_scene_at!).getTime() - new Date(a.created_at).getTime()) / 60000);
  const avgScene = scene.length ? Math.round(scene.reduce((s, x) => s + x, 0) / scene.length) : null;

  if (team.isSuccess && !team.data)
    return (
      <section className="view">
        <Empty>You're not on a response team yet. Ask a coordinator to add {profile.full_name ?? 'you'} to a team.</Empty>
      </section>
    );

  return (
    <section className="view">
      <div className="kpi-grid kpi-3">
        <Kpi label="Active Tasks" icon={RouteIcon} color={C.primary} value={tasks.isLoading ? '—' : open.length} sub={`${doneToday.length} completed today`} />
        <Kpi label="Personnel" icon={Users} color={C.warning} value={team.data?.member_count ?? '—'} sub={team.data ? `${team.data.name} · ${team.data.status === 'AVAILABLE' && !open.length ? 'Standby' : team.data.status.toLowerCase()}` : 'loading…'} />
        <Kpi label="Avg Response Time" icon={Timer} color={C.nominal} value={avgScene == null ? '—' : `${avgScene}m`} sub="dispatch to on-scene" />
      </div>
      {moving && (
        <div className="info-strip"><Navigation size={13} />Sharing your location with the control room while en route{shared ? ` · last sent ${ago(shared)}` : ''}.</div>
      )}
      <div className="task-list">
        {tasks.isLoading && <Empty><Spinner /> Loading tasks…</Empty>}
        {tasks.isSuccess && all.length === 0 && (
          <div className="card task-card">
            <div className="task-card-top">
              <div><div className="task-card-name">{team.data?.name}</div><div className="task-card-sub">No tasks assigned</div></div>
              <Chip color={C.faint}>Standby</Chip>
            </div>
          </div>
        )}
        {all.map((a) => <TaskCard key={a.id} task={a} team={team.data ?? null} roads={roads.data ?? []} />)}
      </div>
    </section>
  );
}

function TaskCard({ task: a, team, roads }: { task: Assignment; team: Team | null; roads: BlockedRoad[] }) {
  const qc = useQueryClient();
  const [showRoute, setShowRoute] = useState(false);
  const Icon = HAZARD_ICON[a.incident_hazard];
  const next = TASK_NEXT[a.status];
  const isOpen = OPEN.includes(a.status);
  const advance = useMutation({
    mutationFn: () => api.patch<Assignment>(`/assignments/${a.id}/status`, { status: next!.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
  const from = team ? (team.current_location ?? team.base_location) : null;
  const route = useQuery({
    queryKey: ['route', a.id, from?.lat, from?.lon, roads.length],
    queryFn: () => api.get<RouteResult>(`/routing/path?from=${from!.lat},${from!.lon}&to=${a.incident_location.lat},${a.incident_location.lon}`),
    enabled: !!from && isOpen,
    staleTime: 5 * 60_000,
  });
  const r = route.data;
  const minsLeft = Math.round((new Date(a.sla_deadline).getTime() - Date.now()) / 60000);
  const activeRoads = roads.filter((x) => x.active);

  return (
    <div className="card task-card" style={{ borderLeft: `3px solid ${TIER_COLOR[a.incident_tier]}` }}>
      <div className="task-card-top">
        <div className="min-w-0">
          <div className="task-card-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon size={16} color={TIER_COLOR[a.incident_tier]} />{a.incident_title}</div>
          <div className="task-card-sub">{a.incident_reference} · {a.team_name}{a.incident_place ? ` · ${a.incident_place}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <TierBadge tier={a.incident_tier} />
          <Chip color={TASK_COLOR[a.status]}>{TASK_LABEL[a.status]}</Chip>
        </div>
      </div>
      {a.instructions && <p className="detail-desc" style={{ marginTop: 8 }}>{a.instructions}</p>}
      <div className="task-card-meta">
        <span className="meta-item"><Users size={13} />{a.team_members} personnel</span>
        {isOpen ? (
          <span className="meta-item" style={{ color: a.sla_breached ? C.critical : undefined }}>
            <Clock size={13} />{a.sla_breached ? `SLA breached (${when(a.sla_deadline)})` : `On scene within ${minsLeft} min (by ${when(a.sla_deadline)})`}
          </span>
        ) : (
          a.completed_at && <span className="meta-item"><CircleCheck size={13} />Completed {when(a.completed_at)}</span>
        )}
        {isOpen && r?.distance_km != null && <span className="meta-item"><MapPin size={13} />{r.distance_km.toFixed(1)} km · ~{Math.round(r.duration_min ?? 0)} min drive</span>}
      </div>
      {isOpen && route.isLoading && <div className="route-note faint"><Spinner size={12} />Planning a route around road closures…</div>}
      {isOpen && r && (r.blocked ? (
        <div className="route-note" style={{ color: C.critical }}><TriangleAlert size={13} />No clear route — passes {r.crosses_closures.length} closure{r.crosses_closures.length === 1 ? '' : 's'}: {r.crosses_closures.join('; ')}</div>
      ) : activeRoads.length > 0 ? (
        <div className="route-note"><TriangleAlert size={13} />Route avoids {activeRoads.length === 1 ? activeRoads[0]!.reason : `${activeRoads.length} closures`}</div>
      ) : null)}
      {showRoute && from && (
        <div className="task-map">
          <MapView
            incidents={[]}
            roads={roads}
            route={r?.geometry?.coordinates ?? null}
            routeBlocked={r?.blocked}
            user={from}
            fitKey={`${a.id}-${r ? 'r' : 'n'}`}
            fitPoints={[from, a.incident_location, ...(r?.geometry?.coordinates ?? []).map(([lon, lat]) => ({ lat: lat!, lon: lon! }))]}
            initialView={{ center: [a.incident_location.lon, a.incident_location.lat], zoom: 11 }}
          />
        </div>
      )}
      <ErrorNote error={advance.error ? errorText(advance.error) : null} />
      {isOpen && (
        <div className="task-status-row">
          {next && (
            <button className="cycle-btn cycle-primary" disabled={advance.isPending} onClick={() => advance.mutate()}>
              {advance.isPending ? <Spinner size={12} /> : <ArrowRight size={12} />}{next.label}
            </button>
          )}
          <button className="cycle-btn" onClick={() => setShowRoute(!showRoute)}><RouteIcon size={12} />{showRoute ? 'Hide route' : 'Show route'}</button>
        </div>
      )}
    </div>
  );
}

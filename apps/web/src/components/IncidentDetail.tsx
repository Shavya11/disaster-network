import type {
  Alert,
  AlertPreview,
  Assignment,
  CheckinSummary,
  GeoJSONPolygon,
  Incident,
  IncidentStatus,
  IncidentTimelineEvent,
  Profile,
  Report,
  SeverityTier,
  Signal,
  Team,
} from '@dn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, FileText, MapPin, Megaphone, Radio, RotateCcw, Send, Truck, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText, qs } from '../lib/api';
import { C, HAZARD_ICON, TASK_COLOR, TASK_LABEL, TIER_COLOR, TIER_LABEL, TIER_ORDER, displayStatus, hhmm, num, tierRank, when } from '../lib/format';
import { circlePolygon } from '../lib/geo';
import { Chip, ErrorNote, Spinner, StatusBadge, TierBadge } from './ui';

const SOURCE_NAME: Record<string, string> = { usgs: 'USGS', 'open-meteo': 'Open-Meteo', gdacs: 'GDACS', firms: 'NASA FIRMS', simulator: 'Simulator' };

type Panel = 'none' | 'alert' | 'assign' | 'reject';

export function IncidentDetail({ incident: inc, profile, onDraftArea }: { incident: Incident; profile: Profile; onDraftArea: (p: GeoJSONPolygon | null) => void }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>('none');
  const [error, setError] = useState<string | null>(null);
  const isStaff = profile.role === 'COORDINATOR' || profile.role === 'ADMIN';
  const st = displayStatus(inc);
  const Icon = HAZARD_ICON[inc.hazard_type];
  const color = TIER_COLOR[inc.severity_tier];
  const id = inc.id;

  const timeline = useQuery({ queryKey: ['timeline', id], queryFn: () => api.get<IncidentTimelineEvent[]>(`/incidents/${id}/timeline`) });
  const alerts = useQuery({ queryKey: ['alerts', id], queryFn: () => api.get<Alert[]>(`/alerts?incident_id=${id}`) });
  const assignments = useQuery({ queryKey: ['assignments', id], queryFn: () => api.get<Assignment[]>(`/assignments?incident_id=${id}`) });
  const signals = useQuery({ queryKey: ['signals', id], queryFn: () => api.get<Signal[]>(`/incidents/${id}/signals`), enabled: inc.signal_count > 0 });
  const reports = useQuery({ queryKey: ['reports', id], queryFn: () => api.get<Report[]>(`/incidents/${id}/reports`), enabled: inc.report_count > 0 });
  const checkins = useQuery({ queryKey: ['checkins', id], queryFn: () => api.get<CheckinSummary>(`/checkins/summary?incident_id=${id}`) });

  const refresh = () => {
    for (const k of ['incidents', 'timeline', 'alerts', 'assignments', 'teams', 'analytics']) void qc.invalidateQueries({ queryKey: [k] });
  };

  const verify = useMutation({
    mutationFn: () => api.post<Incident>(`/incidents/${id}/verify`, {}),
    onSuccess: () => {
      refresh();
      setPanel('alert');
    },
    onError: (e) => setError(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: IncidentStatus) => api.patch<Incident>(`/incidents/${id}/status`, { status }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });

  useEffect(() => {
    if (panel !== 'alert') onDraftArea(null);
  }, [panel, onDraftArea]);

  const sources = [...new Set((signals.data ?? []).map((s) => SOURCE_NAME[s.source] ?? s.source))];
  const origin =
    inc.origin === 'citizen'
      ? `Citizen report${inc.report_count > 1 ? `s (${inc.report_count} merged)` : ''}`
      : `${sources.join(' + ') || 'Live feed'} (automated)${inc.report_count ? ` + ${inc.report_count} citizen report${inc.report_count > 1 ? 's' : ''}` : ''}`;
  const verifiedLine = timeline.data?.find((e) => e.kind === 'status' && /^Verified/.test(e.text));
  const b = inc.severity_breakdown;
  const totals = (alerts.data ?? []).reduce((t, a) => ({ sent: t.sent + a.recipient_count, ack: t.ack + a.acknowledged_count, skipped: t.skipped + a.skipped_duplicates }), { sent: 0, ack: 0, skipped: 0 });
  const offlineDelay = (reports.data ?? []).some((r) => new Date(r.received_at).getTime() - new Date(r.reported_at).getTime() > 5 * 60_000);
  const open = inc.status !== 'RESOLVED' && inc.status !== 'REJECTED';
  const verified = ['VERIFIED', 'ACTIVE', 'CONTAINED'].includes(inc.status);

  return (
    <div className="detail-scroll">
      <div className="detail-head-row">
        <Icon size={20} color={color} style={{ flexShrink: 0 }} />
        <span className="detail-title">{inc.title}</span>
      </div>
      <div className="detail-head-row">
        <TierBadge tier={inc.severity_tier} />
        <StatusBadge status={st} />
        {verified && inc.status !== 'VERIFIED' && <span className="mini-tag">{inc.status}</span>}
      </div>
      <div className="detail-meta-row">
        <MapPin size={13} /><span>{inc.place_name ?? `${inc.epicenter.lat.toFixed(3)}, ${inc.epicenter.lon.toFixed(3)}`}</span>
      </div>
      <div className="detail-meta-row"><Radio size={13} /><span>{origin}{offlineDelay ? ' · offline sync' : ''}</span></div>
      {inc.description && <p className="detail-desc">{inc.description}</p>}
      <div className="detail-meta-row">
        <FileText size={13} />
        <span>{inc.report_count > 0 ? `Supported by ${inc.report_count} independent report${inc.report_count > 1 ? 's' : ''}` : 'Official source data — no citizen reports yet'}</span>
      </div>
      {b && (
        <div className="score-box">
          <div><span className="mono ink">Score {Math.round(inc.severity_score)}</span> = Hazard <span className="mono">{b.H.toFixed(2)}</span> · Exposure <span className="mono">{b.E.toFixed(2)}</span> · Vulnerability <span className="mono">{b.V.toFixed(2)}</span> × Confidence <span className="mono">{b.C.toFixed(2)}</span></div>
          <div className="faint" style={{ marginTop: 4 }}>{b.permission_reason}. Alerts allowed up to <b style={{ color: TIER_COLOR[inc.alert_permission] }}>{TIER_LABEL[inc.alert_permission]}</b>.</div>
        </div>
      )}
      {(assignments.data ?? []).filter((a) => a.status !== 'CANCELLED').map((a) => (
        <div key={a.id} className="detail-meta-row">
          <Users size={13} /><span>Assigned: <b className="ink">{a.team_name}</b></span>
          <Chip color={TASK_COLOR[a.status]}>{TASK_LABEL[a.status]}</Chip>
          {a.sla_breached && a.status !== 'COMPLETED' && <Chip color={C.critical}>SLA breached</Chip>}
        </div>
      ))}

      <ErrorNote error={error} />

      {isStaff && panel === 'none' && (
        <div className="stack-8">
          {inc.status === 'REPORTED' && (
            <div className="action-row">
              <button className="btn btn-verify" disabled={verify.isPending} onClick={() => { setError(null); verify.mutate(); }}>
                {verify.isPending ? <Spinner /> : <Check size={14} />}Verify &amp; Alert
              </button>
              <button className="btn btn-reject" onClick={() => setPanel('reject')}><X size={14} />Reject</button>
            </div>
          )}
          {verified && (
            <>
              <div className="verified-note"><CircleCheck size={13} />{verifiedLine ? `${verifiedLine.text} at ${hhmm(verifiedLine.at)}` : inc.verified_at ? `Verified at ${when(inc.verified_at)}` : 'Verified'}</div>
              <div className="action-row">
                <button className="btn btn-primary" onClick={() => setPanel('alert')}><Megaphone size={14} />Send alert</button>
                <button className="btn btn-reject" onClick={() => setPanel('assign')}><Truck size={14} />Assign team</button>
              </div>
              <div className="action-row">
                {inc.status === 'CONTAINED' ? (
                  <button className="btn btn-ghost" onClick={() => setStatus.mutate('ACTIVE')}>Mark active</button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => setStatus.mutate('CONTAINED')}>Mark contained</button>
                )}
                <button className="btn btn-ghost" onClick={() => setStatus.mutate('RESOLVED')}>Resolve</button>
                <button className="btn btn-ghost" onClick={() => setPanel('reject')}>Reject</button>
              </div>
            </>
          )}
          {inc.status === 'RESOLVED' && <button className="btn btn-ghost" onClick={() => setStatus.mutate('ACTIVE')}><RotateCcw size={13} />Reopen</button>}
          {inc.status === 'REJECTED' && <button className="btn btn-ghost" onClick={() => setStatus.mutate('REPORTED')}><RotateCcw size={13} />Restore to queue</button>}
        </div>
      )}
      {panel === 'reject' && <RejectForm id={id} onDone={() => { setPanel('none'); refresh(); }} onCancel={() => setPanel('none')} />}
      {panel === 'alert' && <AlertComposer incident={inc} onDraftArea={onDraftArea} onDone={() => { setPanel('none'); refresh(); }} />}
      {panel === 'assign' && <AssignForm incident={inc} onDone={() => { setPanel('none'); refresh(); }} />}

      {(alerts.data?.length ?? 0) > 0 && (
        <div className="detail-block">
          <div className="detail-label">Delivery — {alerts.data!.length} alert{alerts.data!.length > 1 ? 's' : ''}</div>
          <div className="delivery-bar">
            <div style={{ flex: totals.ack || 0.0001, background: C.nominal }} />
            <div style={{ flex: totals.sent - totals.ack || 0.0001, background: C.warning }} />
          </div>
          <div className="delivery-stats">
            <span>Targeted <b className="ink mono">{num(totals.sent)}</b></span>
            <span style={{ color: C.nominal }}>Acknowledged <b className="mono">{num(totals.ack)}</b></span>
            <span style={{ color: C.warning }}>Delivered, unseen <b className="mono">{num(totals.sent - totals.ack)}</b></span>
            {totals.skipped > 0 && <span className="faint">Duplicates skipped <b className="mono">{num(totals.skipped)}</b></span>}
          </div>
        </div>
      )}

      {checkins.data && checkins.data.safe + checkins.data.need_help > 0 && (
        <div className="detail-block">
          <div className="detail-label">Check-ins</div>
          <div className="delivery-stats" style={{ marginTop: 0 }}>
            <span style={{ color: C.nominal }}>Safe <b className="mono">{checkins.data.safe}</b></span>
            <span style={{ color: C.critical }}>Need help <b className="mono">{checkins.data.need_help}</b></span>
          </div>
          {checkins.data.need_help_list.slice(0, 4).map((c) => (
            <div key={c.id} className="small dim" style={{ marginTop: 4 }}>• {c.user_name ?? 'Resident'}{c.note ? ` — ${c.note}` : ''} <span className="faint">({when(c.created_at)})</span></div>
          ))}
        </div>
      )}

      {(reports.data?.length ?? 0) > 0 && (
        <div className="detail-block">
          <div className="detail-label">Citizen evidence</div>
          <div className="stack-8">
            {reports.data!.slice(0, 5).map((r) => (
              <div key={r.id} className="evidence-row">
                {r.photo_url && <a href={r.photo_url} target="_blank" rel="noreferrer"><img src={r.photo_url} alt="Report photo" /></a>}
                <div className="min-w-0 small">
                  <div className="dim">{r.description || 'No description'}</div>
                  <div className="faint" style={{ marginTop: 2 }}>
                    {when(r.reported_at)}{r.people_affected ? ` · ${r.people_affected} people` : ''}
                    {new Date(r.received_at).getTime() - new Date(r.reported_at).getTime() > 5 * 60_000 && ` · synced ${when(r.received_at)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-block">
        <div className="detail-label">Audit trail</div>
        <div className="audit-mini">
          {timeline.isLoading && <span className="faint small">Loading…</span>}
          {(timeline.data ?? []).map((e, n) => (
            <div key={n} className="audit-mini-row"><span className="audit-mini-time">{hhmm(e.at)}</span><span className="dim">{e.text}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RejectForm({ id, onDone, onCancel }: { id: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const reject = useMutation({ mutationFn: () => api.post(`/incidents/${id}/reject`, { reason: reason.trim() }), onSuccess: onDone });
  return (
    <div className="inline-panel">
      <div className="detail-label">Reject incident</div>
      <input className="field" autoFocus placeholder="Reason, e.g. duplicate / false report" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorNote error={reject.error ? errorText(reject.error) : null} />
      <div className="action-row">
        <button className="btn btn-danger" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => reject.mutate()}>{reject.isPending ? <Spinner /> : <X size={14} />}Reject</button>
        <button className="btn btn-reject" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AlertComposer({ incident: inc, onDraftArea, onDone }: { incident: Incident; onDraftArea: (p: GeoJSONPolygon | null) => void; onDone: () => void }) {
  const maxTier = inc.alert_permission === 'INFO' ? 'WATCH' : inc.alert_permission;
  const [tier, setTier] = useState<SeverityTier>(tierRank(inc.severity_tier) <= tierRank(maxTier) ? inc.severity_tier : maxTier);
  const [title, setTitle] = useState(`${TIER_LABEL[tier] === 'ADVISORY' ? 'Advisory' : TIER_LABEL[tier][0] + TIER_LABEL[tier].slice(1).toLowerCase()}: ${inc.title}`);
  const [body, setBody] = useState(
    `${inc.title}${inc.place_name ? ` near ${inc.place_name}` : ''}. Follow instructions from local authorities, move to the nearest shelter if advised, and tap "I'm safe" in the app once you are safe.`,
  );
  const [zone, setZone] = useState<'area' | 'radius'>(inc.affected_area ? 'area' : 'radius');
  const [radius, setRadius] = useState(5);
  const geofence = useMemo(() => (zone === 'area' && inc.affected_area ? inc.affected_area : circlePolygon(inc.epicenter, radius)), [zone, radius, inc]);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    onDraftArea(geofence);
    setPreviewing(true);
    const t = setTimeout(() => {
      api.post<AlertPreview>(`/alerts/preview${qs({ incident_id: inc.id })}`, { geofence })
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, 300);
    return () => clearTimeout(t);
  }, [geofence, inc.id, onDraftArea]);

  const send = useMutation({ mutationFn: () => api.post<Alert>('/alerts', { incident_id: inc.id, tier, title: title.trim(), body: body.trim(), geofence }), onSuccess: onDone });

  return (
    <div className="inline-panel">
      <div className="detail-label">Compose alert</div>
      <div className="tier-picker">
        {TIER_ORDER.map((t) => {
          const allowed = tierRank(t) <= tierRank(preview?.max_tier ?? maxTier);
          return (
            <button key={t} disabled={!allowed} className={tier === t ? 'on' : ''} style={{ ['--tc' as string]: TIER_COLOR[t] }} onClick={() => setTier(t)} title={allowed ? undefined : 'Not allowed for this incident yet'}>
              {TIER_LABEL[t]}
            </button>
          );
        })}
      </div>
      <input className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Alert title" />
      <textarea className="field" rows={3} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} aria-label="Alert message" />
      <div className="zone-row">
        {inc.affected_area && (
          <label><input type="radio" checked={zone === 'area'} onChange={() => setZone('area')} /> Incident area</label>
        )}
        <label><input type="radio" checked={zone === 'radius'} onChange={() => setZone('radius')} /> Radius {radius} km</label>
      </div>
      {zone === 'radius' && <input type="range" className="threshold-slider" min={1} max={50} value={radius} onChange={(e) => setRadius(+e.target.value)} aria-label="Alert radius in km" />}
      <div className="preview-line">
        {previewing ? <Spinner size={12} /> : <Users size={13} />}
        {preview ? <span><b className="ink mono">{num(preview.recipient_count)}</b> people in zone · {preview.area_km2.toFixed(1)} km²</span> : <span className="faint">Counting people in the zone…</span>}
      </div>
      <ErrorNote error={send.error ? errorText(send.error) : null} />
      <div className="action-row">
        <button className="btn btn-primary" disabled={send.isPending || title.trim().length < 3 || body.trim().length < 3} onClick={() => send.mutate()}>
          {send.isPending ? <Spinner /> : <Send size={14} />}Send to {preview ? num(preview.recipient_count) : '…'}
        </button>
        <button className="btn btn-reject" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function AssignForm({ incident: inc, onDone }: { incident: Incident; onDone: () => void }) {
  const teams = useQuery({ queryKey: ['teams-near', inc.id], queryFn: () => api.get<Team[]>(`/teams?near_incident=${inc.id}`) });
  const [teamId, setTeamId] = useState<string>('');
  const [instructions, setInstructions] = useState('');
  const available = (teams.data ?? []).filter((t) => t.status === 'AVAILABLE');
  useEffect(() => {
    if (!teamId && available[0]) setTeamId(available[0].id);
  }, [available, teamId]);
  const assign = useMutation({
    mutationFn: () => api.post<Assignment>('/assignments', { incident_id: inc.id, team_id: teamId, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }),
    onSuccess: onDone,
  });
  return (
    <div className="inline-panel">
      <div className="detail-label">Dispatch a team</div>
      {teams.isLoading && <span className="faint small"><Spinner size={12} /> Finding nearest teams…</span>}
      {!teams.isLoading && available.length === 0 && <span className="faint small">No team is available right now.</span>}
      <div className="team-pick">
        {available.slice(0, 6).map((t) => (
          <label key={t.id} className={teamId === t.id ? 'on' : ''}>
            <input type="radio" name="team" checked={teamId === t.id} onChange={() => setTeamId(t.id)} />
            <span className="min-w-0" style={{ flex: 1 }}>
              <span className="ink" style={{ fontWeight: 600 }}>{t.name}</span>
              <span className="faint"> · {t.type.replace('_', ' ')} · {t.member_count} people</span>
            </span>
            {t.distance_km != null && <span className="mono dim">{t.distance_km.toFixed(1)} km</span>}
          </label>
        ))}
      </div>
      <input className="field" placeholder="Instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <ErrorNote error={assign.error ? errorText(assign.error) : null} />
      <div className="action-row">
        <button className="btn btn-primary" disabled={!teamId || assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? <Spinner /> : <Truck size={14} />}Dispatch</button>
        <button className="btn btn-reject" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

import type { BlockedRoad, HazardType, InboxAlert, Incident, LatLon, Profile, Report, Shelter } from '@dn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Camera, Check, CircleCheck, House, LifeBuoy, LogOut, Map as MapIcon, MapPin, Send, Siren, User, WifiOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { MapView } from '../components/MapView';
import { ErrorNote, Spinner, TierBadge } from '../components/ui';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { C, HAZARD_ICON, HAZARD_LABEL, TIER_COLOR, ago, when } from '../lib/format';
import { currentPosition, distanceKm } from '../lib/geo';
import { enqueue, flushQueue, readQueue, type QueuedReport } from '../lib/offline';
import { useRealtime } from '../lib/realtime';
import { supabase } from '../lib/supabase';

type Tab = 'home' | 'map' | 'report' | 'alerts' | 'profile';

const REPORT_HAZARDS: HazardType[] = ['FLOOD', 'FIRE', 'BUILDING_COLLAPSE', 'MEDICAL', 'EARTHQUAKE', 'ROAD_BLOCKAGE', 'GAS_LEAK', 'OTHER'];

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

async function placeName(p: LatLon): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${p.lat}&lon=${p.lon}`);
    const j = (await r.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    return [a.city ?? a.town ?? a.village ?? a.county ?? a.state_district, a.state].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

export function Citizen({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('home');
  const [pos, setPos] = useState<LatLon | null>(profile.location);
  const [place, setPlace] = useState<string | null>(null);
  const [queued, setQueued] = useState(readQueue().length);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  // Locate the user and tell the server (alerts are targeted by last known location).
  useEffect(() => {
    void currentPosition().then((p) => {
      if (!p) return;
      setPos(p);
      if (!profile.location || distanceKm(p, profile.location) > 0.2) void api.put('/me/location', p).catch(() => undefined);
    });
  }, [profile.location]);
  useEffect(() => {
    if (pos) void placeName(pos).then(setPlace);
  }, [pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync the offline queue whenever we're back online.
  useEffect(() => {
    if (!online || !readQueue().length) return;
    flushQueue()
      .then(({ sent, failed }) => {
        setQueued(readQueue().length);
        if (sent) setSyncNote(`${sent} queued report${sent > 1 ? 's' : ''} sent automatically.`);
        if (failed.length) setSyncNote(`Some queued reports were refused: ${failed.join('; ')}`);
        void qc.invalidateQueries({ queryKey: ['reports'] });
      })
      .catch(() => undefined);
  }, [online, qc]);

  useRealtime({ reports: ['reports'], deliveries: ['inbox'] });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<InboxAlert[]>('/alerts/inbox') });
  const unread = (inbox.data ?? []).filter((a) => !a.acknowledged_at).length;

  return (
    <section className="view">
      <div className="phone-wrap">
        <div className="phone">
          <div className="phone-header">
            <span className="phone-header-title">RAKSHAK</span>
            <span className="phone-header-loc"><MapPin size={12} />{place ?? (pos ? `${pos.lat.toFixed(2)}, ${pos.lon.toFixed(2)}` : 'Locating…')}</span>
          </div>
          {!online && <div className="offline-banner"><WifiOff size={13} />You're offline — reports will be queued and sent later.</div>}
          {syncNote && <div className="login-info" onClick={() => setSyncNote(null)}>{syncNote}</div>}
          <div className="phone-body">
            {tab === 'home' && <Home pos={pos} inbox={inbox.data ?? []} queued={queued} goReport={() => setTab('report')} goAlerts={() => setTab('alerts')} />}
            {tab === 'report' && <ReportForm pos={pos} online={online} onQueued={() => setQueued(readQueue().length)} profile={profile} />}
            {tab === 'alerts' && <Alerts inbox={inbox.data ?? []} loading={inbox.isLoading} />}
            {tab === 'map' && <CitizenMap pos={pos} />}
            {tab === 'profile' && <ProfileTab profile={profile} />}
          </div>
          <nav className="phone-nav">
            {([
              ['home', House, 'Home'],
              ['map', MapIcon, 'Map'],
              ['report', Camera, 'Report'],
              ['alerts', Bell, 'Alerts'],
              ['profile', User, 'Profile'],
            ] as const).map(([k, Icon, label]) => (
              <button key={k} className={`phone-nav-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
                <span style={{ position: 'relative' }}>
                  <Icon size={18} />
                  {k === 'alerts' && unread > 0 && <span className="nav-dot" />}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

function Home({ pos, inbox, queued, goReport, goAlerts }: { pos: LatLon | null; inbox: InboxAlert[]; queued: number; goReport: () => void; goAlerts: () => void }) {
  const shelters = useQuery({
    queryKey: ['shelters', 'nearby', pos?.lat.toFixed(3), pos?.lon.toFixed(3)],
    queryFn: () => api.get<Shelter[]>(`/shelters/nearby${qs({ lat: pos!.lat, lon: pos!.lon, radius_km: 50, limit: 3 })}`),
    enabled: !!pos,
  });
  const [checkin, setCheckin] = useState<'SAFE' | 'NEED_HELP' | null>(null);
  const checkinM = useMutation({
    mutationFn: (status: 'SAFE' | 'NEED_HELP') => api.post('/checkins', { status, ...(pos ? { lat: pos.lat, lon: pos.lon } : {}) }),
    onSuccess: (_d, s) => setCheckin(s),
  });
  const alerts = [...inbox].sort((a, b) => Number(!!a.acknowledged_at) - Number(!!b.acknowledged_at)).slice(0, 3);

  return (
    <>
      <div className="sos-wrap">
        <button className="sos-btn" onClick={goReport}><Siren size={30} /><span className="sos-btn-label">SOS</span></button>
        <span className="sos-caption">Press to report an emergency — GPS, photo<br />and a one-line description, in about 8 seconds.</span>
      </div>
      <div className="phone-section">
        <div className="phone-section-title">Nearby Alerts</div>
        {alerts.length === 0 && <div className="small faint">No alerts for your area right now.</div>}
        {alerts.map((a) => (
          <button key={a.alert_id} className="phone-alert-card" style={{ borderLeft: `3px solid ${TIER_COLOR[a.tier]}`, opacity: a.acknowledged_at ? 0.65 : 1 }} onClick={goAlerts}>
            <Bell size={16} color={TIER_COLOR[a.tier]} style={{ marginTop: 2, flexShrink: 0 }} />
            <div className="min-w-0">
              <div className="small ink" style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="small dim clamp-2" style={{ marginTop: 2, lineHeight: 1.4 }}>{a.body}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="phone-section">
        <div className="phone-section-title">Nearest Shelters</div>
        {!pos && <div className="small faint">Allow location access to see shelters near you.</div>}
        {shelters.isLoading && pos && <div className="small faint"><Spinner size={12} /> Finding shelters…</div>}
        {shelters.data?.length === 0 && <div className="small faint">No shelters within 50 km.</div>}
        {shelters.data?.map((s) => {
          const pct = s.capacity ? Math.round((s.current_occupancy / s.capacity) * 100) : 0;
          const col = pct >= 90 ? C.critical : pct >= 60 ? C.warning : C.nominal;
          return (
            <div key={s.id} className="phone-shelter-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="small ink" style={{ fontWeight: 600 }}>{s.name}</span>
                <span className="small dim" style={{ flexShrink: 0 }}>{s.distance_km?.toFixed(1)} km</span>
              </div>
              <div className="small dim" style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0 5px' }}>
                <span>{s.status === 'OPEN' ? `${s.current_occupancy} / ${s.capacity} occupants` : s.status}</span><span style={{ color: col }}>{pct}%</span>
              </div>
              <div className="occ-bar"><div style={{ width: `${Math.min(pct, 100)}%`, background: col }} /></div>
            </div>
          );
        })}
      </div>
      {checkin ? (
        <div className="safe-done" style={{ color: checkin === 'SAFE' ? C.nominal : C.critical }}>
          <CircleCheck size={15} />{checkin === 'SAFE' ? 'Checked in as safe — thank you.' : 'Help request sent to the control room.'}
        </div>
      ) : (
        <>
          <button className="safe-btn" disabled={checkinM.isPending} onClick={() => checkinM.mutate('SAFE')}>
            {checkinM.isPending ? <Spinner /> : <CircleCheck size={15} />}I'm Safe — Check In
          </button>
          <button className="help-btn" disabled={checkinM.isPending} onClick={() => checkinM.mutate('NEED_HELP')}><LifeBuoy size={14} />I need help</button>
        </>
      )}
      <ErrorNote error={checkinM.error ? errorText(checkinM.error) : null} />
      <div className="offline-note">
        <WifiOff size={14} />
        <span>{queued ? `${queued} report${queued > 1 ? 's' : ''} waiting to sync.` : 'Works offline — queued reports sync automatically when signal returns.'}</span>
      </div>
    </>
  );
}

function ReportForm({ pos, online, onQueued, profile }: { pos: LatLon | null; online: boolean; onQueued: () => void; profile: Profile }) {
  const qc = useQueryClient();
  const [hazard, setHazard] = useState<HazardType | null>(null);
  const [desc, setDesc] = useState('');
  const [people, setPeople] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ['reports', 'mine'], queryFn: () => api.get<Report[]>('/reports/mine') });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hazard) return setError('Pick what is happening.');
    const at = pos ?? (await currentPosition(5000));
    if (!at) return setError('We need your location to send help. Allow location access and try again.');
    setBusy(true);
    setError(null);
    const report: QueuedReport = {
      client_generated_id: crypto.randomUUID(),
      hazard_type: hazard,
      lat: at.lat,
      lon: at.lon,
      reported_at: new Date().toISOString(),
      ...(desc.trim() ? { description: desc.trim() } : {}),
      ...(people ? { people_affected: Number(people) } : {}),
    };
    try {
      if (!online) throw new TypeError('offline');
      if (photo) {
        const path = `${profile.id}/${crypto.randomUUID()}.${photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'}`;
        const up = await supabase.storage.from('report-photos').upload(path, photo, { contentType: photo.type });
        if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
        report.photo_url = supabase.storage.from('report-photos').getPublicUrl(path).data.publicUrl;
      }
      await api.post<Report>('/reports', report);
      setDone('Report received. The control room can see it now.');
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (err) {
      if (err instanceof TypeError) {
        // No connection: keep it on the device and send it when signal returns.
        enqueue(report);
        onQueued();
        setDone(`No connection — report saved on this phone and will send automatically${photo ? ' (without the photo)' : ''}.`);
      } else {
        setError(errorText(err));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setHazard(null);
    setDesc('');
    setPeople('');
    setPhoto(null);
  }

  return (
    <>
      <form onSubmit={submit} className="stack-8">
        <div className="phone-section-title">What is happening?</div>
        <div className="hazard-grid">
          {REPORT_HAZARDS.map((h) => {
            const Icon = HAZARD_ICON[h];
            return (
              <button type="button" key={h} className={hazard === h ? 'on' : ''} onClick={() => setHazard(h)}>
                <Icon size={18} />
                <span>{HAZARD_LABEL[h]}</span>
              </button>
            );
          })}
        </div>
        <textarea className="field" rows={2} placeholder="One line, e.g. water up to first floor, 4 people trapped" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="field" type="number" min={0} max={10000} placeholder="People affected" value={people} onChange={(e) => setPeople(e.target.value)} />
          <label className="photo-btn">
            <Camera size={15} />{photo ? 'Photo added' : 'Add photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="small faint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={12} />{pos ? `Location attached (${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)})` : 'Location will be requested when you send'}</div>
        <ErrorNote error={error} />
        {done && <div className="login-info">{done}</div>}
        <button className="login-submit" style={{ marginTop: 4 }} disabled={busy}>{busy ? <Spinner size={16} /> : <Send size={16} />}Send report</button>
      </form>
      <div className="phone-section">
        <div className="phone-section-title">My reports</div>
        {mine.data?.length === 0 && <div className="small faint">You haven't sent any reports yet.</div>}
        {mine.data?.slice(0, 6).map((r) => {
          const verified = r.incident_status && ['VERIFIED', 'ACTIVE', 'CONTAINED', 'RESOLVED'].includes(r.incident_status);
          const Icon = HAZARD_ICON[r.hazard_type];
          return (
            <div key={r.id} className="phone-alert-card">
              <Icon size={15} color={C.dim} style={{ marginTop: 2, flexShrink: 0 }} />
              <div className="min-w-0" style={{ flex: 1 }}>
                <div className="small ink" style={{ fontWeight: 600 }}>{HAZARD_LABEL[r.hazard_type]}</div>
                <div className="small faint">{when(r.reported_at)}</div>
              </div>
              <span className="small" style={{ color: verified ? C.nominal : r.incident_status === 'REJECTED' ? C.faint : C.warning, flexShrink: 0 }}>
                {verified ? 'Verified by authorities' : r.incident_status === 'REJECTED' ? 'Closed' : 'Report received'}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Alerts({ inbox, loading }: { inbox: InboxAlert[]; loading: boolean }) {
  const qc = useQueryClient();
  const ack = useMutation({ mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`), onSettled: () => qc.invalidateQueries({ queryKey: ['inbox'] }) });
  return (
    <div className="phone-section" style={{ marginTop: 0 }}>
      <div className="phone-section-title">Alerts for your area</div>
      {loading && <div className="small faint"><Spinner size={12} /> Loading…</div>}
      {!loading && inbox.length === 0 && <div className="small faint">No alerts. You'll be notified here if one is issued for your location.</div>}
      {inbox.map((a) => (
        <div key={a.alert_id} className="phone-alert-card" style={{ borderLeft: `3px solid ${TIER_COLOR[a.tier]}`, flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><TierBadge tier={a.tier} /><span className="small faint">{ago(a.received_at)}</span></div>
          <div className="small ink" style={{ fontWeight: 600 }}>{a.title}</div>
          <div className="small dim" style={{ lineHeight: 1.45 }}>{a.body}</div>
          {a.acknowledged_at ? (
            <span className="small" style={{ color: C.nominal, display: 'flex', alignItems: 'center', gap: 5 }}><Check size={13} />Seen</span>
          ) : (
            <button className="cycle-btn" style={{ alignSelf: 'flex-start' }} onClick={() => ack.mutate(a.alert_id)}><Check size={12} />I've seen this</button>
          )}
        </div>
      ))}
    </div>
  );
}

function CitizenMap({ pos }: { pos: LatLon | null }) {
  const bbox = pos ? [pos.lon - 1.5, pos.lat - 1.5, pos.lon + 1.5, pos.lat + 1.5].map((n) => n.toFixed(3)).join(',') : undefined;
  const incidents = useQuery({ queryKey: ['incidents', 'near', bbox], queryFn: () => api.get<Incident[]>(`/incidents${qs({ bbox, limit: 100 })}`) });
  const shelters = useQuery({
    queryKey: ['shelters', 'map', pos?.lat.toFixed(2), pos?.lon.toFixed(2)],
    queryFn: () => api.get<Shelter[]>(`/shelters/nearby${qs({ lat: pos!.lat, lon: pos!.lon, radius_km: 30, limit: 60 })}`),
    enabled: !!pos,
  });
  const roads = useQuery({ queryKey: ['roads'], queryFn: () => api.get<BlockedRoad[]>('/roads/blocked') });
  const open = (incidents.data ?? []).filter((i) => i.status !== 'RESOLVED' && i.status !== 'REJECTED');
  return (
    <div className="phone-map">
      <MapView
        incidents={open}
        shelters={shelters.data}
        roads={roads.data}
        user={pos}
        initialView={pos ? { center: [pos.lon, pos.lat], zoom: 11 } : undefined}
        hint="green = shelter · red line = road closed"
      />
    </div>
  );
}

function ProfileTab({ profile }: { profile: Profile }) {
  const { refreshProfile, signOut } = useAuth();
  const [name, setName] = useState(profile.full_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [radius, setRadius] = useState(Math.round(profile.alert_radius_m / 1000));
  const save = useMutation({
    mutationFn: () => api.patch<Profile>('/me', { ...(name.trim() ? { full_name: name.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}), alert_radius_m: radius * 1000 }),
    onSuccess: () => void refreshProfile(),
  });
  return (
    <div className="stack-8">
      <div className="phone-section-title">Your profile</div>
      <label className="login-label" style={{ marginTop: 0 }}>Full name</label>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="login-label" style={{ marginTop: 0 }}>Phone</label>
      <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
      <div className="threshold-top" style={{ marginTop: 6 }}>
        <span className="threshold-label">Alert me about incidents within</span>
        <span className="threshold-value">{radius} km</span>
      </div>
      <input type="range" className="threshold-slider" min={1} max={50} value={radius} onChange={(e) => setRadius(+e.target.value)} />
      <ErrorNote error={save.error ? errorText(save.error) : null} />
      {save.isSuccess && <div className="login-info">Saved.</div>}
      <button className="login-submit" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner size={16} /> : <Check size={16} />}Save</button>
      <button className="help-btn" onClick={() => void signOut()}><LogOut size={14} />Sign out</button>
      <div className="small faint">Signed in as {profile.email}</div>
    </div>
  );
}

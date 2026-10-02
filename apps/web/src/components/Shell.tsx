import type { InboxAlert, Profile, UserRole } from '@dn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Clock, LayoutDashboard, Lock, LogOut, Menu, Route, Shield, Siren, Smartphone, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL, TIER_COLOR, ago, initials } from '../lib/format';
import { useRealtime } from '../lib/realtime';
import { Admin } from '../views/Admin';
import { Citizen } from '../views/Citizen';
import { Coordinator } from '../views/Coordinator';
import { Responder } from '../views/Responder';
import { TierBadge } from './ui';

type ViewKey = 'coordinator' | 'citizen' | 'responder' | 'admin';

const VIEWS: { key: ViewKey; label: string; sub: string; title: string; icon: LucideIcon; roles: UserRole[] }[] = [
  { key: 'coordinator', label: 'Coordinator', sub: 'Command dashboard', title: 'Coordinator Console', icon: LayoutDashboard, roles: ['COORDINATOR', 'ADMIN'] },
  { key: 'citizen', label: 'Citizen App', sub: 'SOS · alerts · shelters', title: 'Citizen App', icon: Smartphone, roles: ['CITIZEN'] },
  { key: 'responder', label: 'Responder', sub: 'Tasks & routing', title: 'Responder Console', icon: Route, roles: ['RESPONDER'] },
  { key: 'admin', label: 'Admin', sub: 'Sources · metrics · audit', title: 'Admin & Analytics', icon: Shield, roles: ['ADMIN'] },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('en-IN', { hour12: false });
}

function BellMenu() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<InboxAlert[]>('/alerts/inbox'), refetchInterval: 60_000 });
  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const unread = (inbox.data ?? []).filter((a) => !a.acknowledged_at);

  return (
    <div style={{ position: 'relative' }}>
      <button className="bell-btn" onClick={() => setOpen(!open)} aria-label={`Alerts, ${unread.length} unread`}>
        <Bell size={18} color="#AB9F8C" />
        {unread.length > 0 && <span className="bell-badge">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <>
          <div className="pop-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-menu card">
            <div className="panel-head"><span className="section-title">YOUR ALERTS</span><span className="dim small">{unread.length} unread</span></div>
            <div className="bell-list">
              {(inbox.data ?? []).length === 0 && <div className="empty">No alerts for your area.</div>}
              {(inbox.data ?? []).slice(0, 20).map((a) => (
                <div key={a.alert_id} className="phone-alert-card" style={{ borderLeft: `3px solid ${TIER_COLOR[a.tier]}`, opacity: a.acknowledged_at ? 0.6 : 1 }}>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><TierBadge tier={a.tier} /><span className="faint small">{ago(a.received_at)}</span></div>
                    <div className="small ink" style={{ fontWeight: 600, marginTop: 5 }}>{a.title}</div>
                    <div className="small dim" style={{ marginTop: 2, lineHeight: 1.4 }}>{a.body}</div>
                  </div>
                  {!a.acknowledged_at && (
                    <button className="icon-btn" title="Mark as seen" aria-label="Mark as seen" onClick={() => ack.mutate(a.alert_id)}><Check size={15} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Shell({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const allowed = VIEWS.filter((v) => v.roles.includes(profile.role));
  const [view, setView] = useState<ViewKey>(allowed[0]?.key ?? 'citizen');
  const [drawer, setDrawer] = useState(false);
  const clock = useClock();
  const current = VIEWS.find((v) => v.key === view)!;
  useRealtime({ deliveries: ['inbox'], alerts: ['inbox'] });

  return (
    <div className="app">
      <div className={`sidebar-backdrop${drawer ? ' show' : ''}`} onClick={() => setDrawer(false)} />
      <aside className={`sidebar${drawer ? ' open' : ''}`}>
        <div>
          <div className="brand">
            <div className="brand-icon"><Siren size={18} /></div>
            <div className="brand-text">
              <div className="brand-title">RAKSHAK</div>
              <div className="brand-sub">Intelligent Disaster Monitoring &amp;<br />Emergency Communication Network</div>
            </div>
            <button className="sidebar-close" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <nav className="nav">
            {VIEWS.map((v) => {
              const permitted = v.roles.includes(profile.role);
              return (
                <button
                  key={v.key}
                  className={`nav-item${view === v.key ? ' active' : ''}${permitted ? '' : ' locked'}`}
                  disabled={!permitted}
                  title={permitted ? undefined : `Requires the ${v.roles.map((r) => ROLE_LABEL[r]).join(' or ')} role`}
                  onClick={() => {
                    setView(v.key);
                    setDrawer(false);
                  }}
                >
                  <v.icon size={18} />
                  <span className="min-w-0">
                    <span className="nav-item-label">{v.label}</span>
                    <div className="nav-item-sub">{v.sub}</div>
                  </span>
                  <Lock size={14} className="nav-lock-icon" />
                </button>
              );
            })}
          </nav>
        </div>
        <div className="profile-card">
          <div className="profile-avatar">{initials(profile.full_name ?? profile.email)}</div>
          <div className="profile-info">
            <div className="profile-name">{profile.full_name ?? profile.email}</div>
            <div className="profile-role">{ROLE_LABEL[profile.role]}</div>
          </div>
          <button className="logout-btn" onClick={() => void signOut()} title="Log out" aria-label="Log out"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="min-w-0" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
            <div className="min-w-0">
              <div className="eyebrow">Signed in — RAKSHAK Platform</div>
              <h1 className="topbar-title">{current.title}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <div className="clock mono dim"><span className="live-dot" /><Clock size={14} /><span>{clock}</span></div>
            <BellMenu />
          </div>
        </header>
        <main className={`content${view === 'coordinator' ? ' content-console' : ''}`}>
          {view === 'coordinator' && <Coordinator profile={profile} />}
          {view === 'citizen' && <Citizen profile={profile} />}
          {view === 'responder' && <Responder profile={profile} />}
          {view === 'admin' && <Admin />}
        </main>
      </div>
    </div>
  );
}

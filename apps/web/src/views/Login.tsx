import { CircleCheck, LayoutDashboard, LogIn, Route, Shield, Siren, Smartphone, UserPlus, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Spinner } from '../components/ui';
import { DEMO_PASSWORD } from '../lib/config';
import { supabase } from '../lib/supabase';

const ROLES: { key: string; name: string; desc: string; icon: LucideIcon; email: string }[] = [
  { key: 'coordinator', name: 'Coordinator', desc: 'Verify incidents, draw alert zones, dispatch teams', icon: LayoutDashboard, email: 'coordinator@demo.dn' },
  { key: 'citizen', name: 'Citizen App', desc: 'Report emergencies, get alerts, find shelters', icon: Smartphone, email: 'citizen@demo.dn' },
  { key: 'responder', name: 'Responder', desc: 'View tasks, navigate routes, update status', icon: Route, email: 'responder@demo.dn' },
  { key: 'admin', name: 'Admin', desc: 'Manage data sources, users and the audit log', icon: Shield, email: 'admin@demo.dn' },
];

const FEATURES = [
  'Real-time hazard ingestion from USGS, Open-Meteo and GDACS',
  'Geofenced, targeted alerts with delivery tracking',
  'Offline-first citizen reporting that syncs automatically',
  'An unchangeable audit trail for every decision',
];

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // With a demo password configured, a role card signs straight in as that demo account.
  function pickRole(r: (typeof ROLES)[number]) {
    setRole(r.key);
    setEmail(r.email);
    setError(null);
    if (DEMO_PASSWORD) {
      setPassword(DEMO_PASSWORD);
      void signIn(r.email, DEMO_PASSWORD);
    }
  }

  async function signIn(mail: string, pass: string) {
    setBusy(true);
    const res = await supabase.auth.signInWithPassword({ email: mail, password: pass });
    setBusy(false);
    if (res.error) setError(res.error.message === 'Invalid login credentials' ? 'Wrong email or password.' : res.error.message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (mode === 'signup' && name.trim().length < 2) return setError('Enter your full name.');
    if (mode === 'signin') return signIn(email.trim(), password);
    setBusy(true);
    const res = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (res.error) return setError(res.error.message === 'Invalid login credentials' ? 'Wrong email or password.' : res.error.message);
    if (!res.data.session) setInfo('Account created. Check your email to confirm it, then sign in.');
  }

  return (
    <div id="login-screen">
      <div className="login-brand-panel">
        <div className="login-brand-icon"><Siren size={24} /></div>
        <div className="login-brand-title">RAKSHAK</div>
        <p className="login-brand-tagline">
          Intelligent Disaster Monitoring &amp; Emergency Communication Network — one application, one login, four interfaces depending on who you are.
        </p>
        <ul className="login-feature-list">
          {FEATURES.map((f) => (
            <li key={f}><CircleCheck size={15} className="ic" /><span>{f}</span></li>
          ))}
        </ul>
      </div>
      <div className="login-form-panel">
        <form className="login-card" onSubmit={submit}>
          <h2 className="login-heading">{mode === 'signin' ? 'Sign in' : 'Create a citizen account'}</h2>
          <p className="login-sub">
            {mode === 'signin' ? (DEMO_PASSWORD ? 'Tap a role to enter its demo account, or sign in with your own email.' : 'Pick a demo account or enter your own email. Your role decides which console opens.') : 'Get alerts near you, report emergencies and find shelters.'}
          </p>
          {mode === 'signin' && (
            <div className="role-card-grid">
              {ROLES.map((r) => (
                <button key={r.key} type="button" disabled={busy} className={`role-card${role === r.key ? ' selected' : ''}`} onClick={() => pickRole(r)}>
                  <r.icon size={20} />
                  <span className="role-card-name">{r.name}</span>
                  <span className="role-card-desc">{r.desc}</span>
                </button>
              ))}
            </div>
          )}
          {mode === 'signup' && (
            <>
              <label className="login-label" htmlFor="login-name">Full name</label>
              <input className="login-input" id="login-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Shah" autoComplete="name" />
            </>
          )}
          <label className="login-label" htmlFor="login-email">Email</label>
          <input className="login-input" id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          <label className="login-label" htmlFor="login-password">Password</label>
          <input className="login-input" id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
          {error && <div className="login-error">{error}</div>}
          {info && <div className="login-info">{info}</div>}
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? <Spinner size={16} /> : mode === 'signin' ? <LogIn size={16} /> : <UserPlus size={16} />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <p className="login-footnote">
            {mode === 'signin' ? (
              <>New here? <button type="button" className="link-btn" onClick={() => setMode('signup')}>Create a citizen account</button>. Other roles are assigned by an administrator.</>
            ) : (
              <>Already registered? <button type="button" className="link-btn" onClick={() => setMode('signin')}>Sign in</button></>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}

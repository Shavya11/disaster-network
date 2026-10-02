import { useEffect, useState } from 'react';
import { Siren } from 'lucide-react';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { API_URL } from './lib/config';
import { useAuth } from './lib/auth';
import { Login } from './views/Login';

/** The free API host sleeps when idle; ping it early and say so if it's slow to answer. */
function useServerWake() {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    let done = false;
    const slow = setTimeout(() => !done && setWaking(true), 2500);
    const ping = (): Promise<void> =>
      fetch(`${API_URL}/health`)
        .then(() => undefined)
        .catch(() => new Promise<void>((r) => setTimeout(r, 4000)).then(ping));
    void ping().then(() => {
      done = true;
      setWaking(false);
    });
    return () => clearTimeout(slow);
  }, []);
  return waking;
}

function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div id="splash-screen" onClick={onDone}>
      <div className="splash-inner">
        <div className="splash-icon"><Siren size={34} /></div>
        <div className="splash-title">RAKSHAK</div>
        <div className="splash-tagline">Intelligent Disaster Monitoring &amp; Emergency Communication Network</div>
        <div className="splash-bar"><div className="splash-bar-fill" /></div>
        <div className="splash-hint">tap anywhere to continue</div>
      </div>
    </div>
  );
}

export function App() {
  const { session, profile, profileError, signOut } = useAuth();
  const [splash, setSplash] = useState(() => !sessionStorage.getItem('rk-splash'));
  const waking = useServerWake();

  const endSplash = () => {
    sessionStorage.setItem('rk-splash', '1');
    setSplash(false);
  };

  let body;
  if (splash) body = <Splash onDone={endSplash} />;
  else if (session === undefined) body = <div className="center-fill"><Spinner size={22} /></div>;
  else if (!session) body = <Login />;
  else if (!profile)
    body = (
      <div className="center-fill">
        {profileError ? (
          <div className="login-card" style={{ alignItems: 'center', gap: 12 }}>
            <div className="login-error">{profileError}</div>
            <button className="cycle-btn" onClick={() => void signOut()}>Back to sign in</button>
          </div>
        ) : (
          <>
            <Spinner size={22} />
            <span className="map-loading-text">Loading your profile…</span>
          </>
        )}
      </div>
    );
  else body = <Shell profile={profile} />;

  return (
    <>
      {waking && !splash && (
        <div className="wake-banner">
          <Spinner size={13} /> Waking up the server — the free host sleeps when idle, this takes up to a minute…
        </div>
      )}
      {body}
    </>
  );
}

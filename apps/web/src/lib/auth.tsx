import type { Profile } from '@dn/shared';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { supabase } from './supabase';

interface AuthState {
  /** undefined while the stored session is being restored. */
  session: Session | null | undefined;
  profile: Profile | null;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  async function refreshProfile() {
    try {
      setProfile(await api.get<Profile>('/me'));
      setProfileError(null);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Could not load your profile');
    }
  }

  useEffect(() => {
    setProfile(null);
    if (userId) void refreshProfile();
  }, [userId]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, profile, profileError, refreshProfile, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

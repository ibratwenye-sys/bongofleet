import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from './api';
import { tokenStore } from './token-store';
import type { CurrentUser, TokenResponse } from './types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: CurrentUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    async function bootstrap() {
      if (!tokenStore.getRefreshToken()) {
        setStatus('unauthenticated');
        return;
      }

      try {
        const tokens = await apiFetch<TokenResponse>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: tokenStore.getRefreshToken() }),
        });
        tokenStore.setTokens(tokens);
        const me = await apiFetch<CurrentUser>('/auth/me');
        setUser(me);
        setStatus('authenticated');
      } catch {
        tokenStore.clear();
        setStatus('unauthenticated');
      }
    }
    void bootstrap();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await apiFetch<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStore.setTokens(tokens);
    const me = await apiFetch<CurrentUser>('/auth/me');
    setUser(me);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // best-effort - clear local state regardless
    }
    tokenStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

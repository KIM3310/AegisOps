
import { useState, useCallback, useEffect, useRef } from 'react';
import { loadGoogleIdentity } from '../services/googleIdentity';
const TOKEN_KEY = 'google_access_token';
const USER_KEY = 'google_user';
const TOKEN_EXPIRES_AT_KEY = 'google_access_token_expires_at';
const TOKEN_EXPIRY_GRACE_MS = 30_000;
const DEMO_TOKEN = 'demo_token';
const DEMO_SIGN_IN_DELAY_MS = 250;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

function clearStoredAuth(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
}

function safeParseUser(raw: string | null): GoogleUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const email = String((parsed as any).email || '').trim();
    const name = String((parsed as any).name || '').trim();
    const pictureRaw = (parsed as any).picture;
    const picture = pictureRaw ? String(pictureRaw) : undefined;
    if (!email || !name) return null;
    return { email, name, picture };
  } catch {
    return null;
  }
}

function isExpired(expiresAtMs: number | null): boolean {
  if (!expiresAtMs || !Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= Date.now() + TOKEN_EXPIRY_GRACE_MS;
}

export function useGoogleAuth() {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const activeSignIn = useRef<symbol | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const restoredUser = safeParseUser(sessionStorage.getItem(USER_KEY));
    const expiresAtRaw = sessionStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    const expiresAtMs = expiresAtRaw ? Number(expiresAtRaw) : null;

    if (!clientId && token === DEMO_TOKEN && restoredUser) {
      setAccessToken(DEMO_TOKEN);
      setUser(restoredUser);
      setIsAuthenticated(true);
    } else if (clientId && token && token !== DEMO_TOKEN && restoredUser && !isExpired(expiresAtMs)) {
      setAccessToken(token);
      setUser(restoredUser);
      setIsAuthenticated(true);
    } else {
      clearStoredAuth();
    }

    setIsLoading(false);
    return () => { activeSignIn.current = null; };
  }, [clientId]);

  const signIn = useCallback(async () => {
    if (activeSignIn.current) return;
    const attempt = Symbol();
    activeSignIn.current = attempt;
    setAuthError(null);
    setIsLoading(true);

    const failSignIn = (message: string) => {
      if (activeSignIn.current !== attempt) return;
      activeSignIn.current = null;
      clearStoredAuth();
      setIsAuthenticated(false);
      setUser(null);
      setAccessToken(null);
      setAuthError(message);
      setIsLoading(false);
    };
    const completeSignIn = (token: string, signedInUser: GoogleUser, expiresAtMs?: number) => {
      if (activeSignIn.current !== attempt) return;
      activeSignIn.current = null;
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(signedInUser));
      if (expiresAtMs) sessionStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAtMs));
      else sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
      setAccessToken(token);
      setUser(signedInUser);
      setIsAuthenticated(true);
      setIsLoading(false);
    };

    if (!clientId) {
      await new Promise((resolve) => setTimeout(resolve, DEMO_SIGN_IN_DELAY_MS));
      completeSignIn(DEMO_TOKEN, { email: 'demo@aegisops.dev', name: 'Demo SRE' });
      return;
    }

    try {
      const oauth2 = await loadGoogleIdentity();
      if (activeSignIn.current !== attempt) return;
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: async (response) => {
          if (activeSignIn.current !== attempt) return;
          const token = response.access_token?.trim();
          if (response.error || !token) {
            failSignIn('Google sign-in was not completed. Try again.');
            return;
          }

          const expiresInSec = Number(response.expires_in || 0);
          const expiresAtMs =
            Number.isFinite(expiresInSec) && expiresInSec > 0
              ? Date.now() + expiresInSec * 1000
              : Date.now() + 55 * 60 * 1000;
          let signedInUser: GoogleUser;
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!userRes.ok) throw new Error(`userinfo failed: ${userRes.status}`);
            const userData = await userRes.json();
            signedInUser = { email: userData.email, name: userData.name, picture: userData.picture };
          } catch {
            console.warn('Failed to fetch user profile, but auth is valid');
            signedInUser = {
              email: 'authenticated@profile-unavailable.local',
              name: 'Authenticated (profile unavailable)',
            };
          }
          completeSignIn(token, signedInUser, expiresAtMs);
        },
        error_callback: (error) => {
          failSignIn(error.type === 'popup_closed'
            ? 'Google sign-in was closed. Try again.'
            : 'Google sign-in could not open. Allow popups and try again.');
        },
      });
      client.requestAccessToken();
    } catch (error) {
      failSignIn(error instanceof Error ? error.message : 'Google sign-in failed. Try again.');
    }
  }, [clientId]);

  useEffect(() => {
    if (!accessToken || accessToken === DEMO_TOKEN) return;
    const expiresAtRaw = sessionStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    const expiresAtMs = expiresAtRaw ? Number(expiresAtRaw) : 0;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      clearStoredAuth();
      setAccessToken(null);
      setUser(null);
      setIsAuthenticated(false);
      return;
    }

    const timeoutMs = Math.max(1_000, expiresAtMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      clearStoredAuth();
      setAccessToken(null);
      setUser(null);
      setIsAuthenticated(false);
    }, timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [accessToken]);

  const signOut = useCallback(() => {
    activeSignIn.current = null;
    if (accessToken && accessToken !== DEMO_TOKEN) {
      window.google?.accounts?.oauth2?.revoke(accessToken);
    }

    setAuthError(null);
    setIsLoading(false);
    setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
    clearStoredAuth();
  }, [accessToken]);

  const isDemoMode = accessToken === DEMO_TOKEN;

  return { isAuthenticated, isLoading, user, accessToken, signIn, signOut, isDemoMode, authError, isGoogleConfigured: Boolean(clientId) };
}

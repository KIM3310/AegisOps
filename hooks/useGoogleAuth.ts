
import { useState, useCallback, useEffect } from 'react';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const restoredUser = safeParseUser(sessionStorage.getItem(USER_KEY));
    const expiresAtRaw = sessionStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    const expiresAtMs = expiresAtRaw ? Number(expiresAtRaw) : null;

    if (token === DEMO_TOKEN && restoredUser) {
      setAccessToken(DEMO_TOKEN);
      setUser(restoredUser);
      setIsAuthenticated(true);
    } else if (token && restoredUser && !isExpired(expiresAtMs)) {
      setAccessToken(token);
      setUser(restoredUser);
      setIsAuthenticated(true);
    } else {
      clearStoredAuth();
    }

    setIsLoading(false);
  }, []);

  const signIn = useCallback(async () => {
    setIsLoading(true);

    if (CLIENT_ID && (window as any).google?.accounts?.oauth2) {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response: any) => {
          if (response?.error) {
            clearStoredAuth();
            setIsAuthenticated(false);
            setUser(null);
            setAccessToken(null);
            setIsLoading(false);
            return;
          }

          if (response.access_token) {
            const token = String(response.access_token).trim();
            const expiresInSec = Number(response.expires_in || 0);
            const expiresAtMs =
              Number.isFinite(expiresInSec) && expiresInSec > 0
                ? Date.now() + expiresInSec * 1000
                : Date.now() + 55 * 60 * 1000;

            setAccessToken(token);
            sessionStorage.setItem(TOKEN_KEY, token);
            sessionStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAtMs));

            try {
              const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!userRes.ok) {
                throw new Error(`userinfo failed: ${userRes.status}`);
              }
              const userData = await userRes.json();
              const u: GoogleUser = {
                email: userData.email,
                name: userData.name,
                picture: userData.picture,
              };
              setUser(u);
              setIsAuthenticated(true);
              sessionStorage.setItem(USER_KEY, JSON.stringify(u));
            } catch {
              console.warn('Failed to fetch user profile, but auth is valid');
              setIsAuthenticated(true);
              const fallbackUser: GoogleUser = { email: 'unknown@google-user', name: 'Google User' };
              setUser(fallbackUser);
              sessionStorage.setItem(USER_KEY, JSON.stringify(fallbackUser));
            }
          }
          setIsLoading(false);
        },
      });
      client.requestAccessToken();
    } else {
      await new Promise((resolve) => setTimeout(resolve, DEMO_SIGN_IN_DELAY_MS));

      const demoUser: GoogleUser = {
        email: 'demo@aegisops.dev',
        name: 'Demo SRE',
      };
      
      setUser(demoUser);
      setAccessToken(DEMO_TOKEN); 
      setIsAuthenticated(true);
      
      sessionStorage.setItem(USER_KEY, JSON.stringify(demoUser));
      sessionStorage.setItem(TOKEN_KEY, DEMO_TOKEN);
      sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
      setIsLoading(false);
    }
  }, []);

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
    if (accessToken && accessToken !== DEMO_TOKEN && (window as any).google?.accounts?.oauth2) {
      (window as any).google.accounts.oauth2.revoke(accessToken);
    }
    
    setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
    clearStoredAuth();
  }, [accessToken]);

  const isDemoMode = accessToken === DEMO_TOKEN;

  return { isAuthenticated, isLoading, user, accessToken, signIn, signOut, isDemoMode };
}

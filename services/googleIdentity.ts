const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 10_000;

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

export interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback: (error: { type: string }) => void;
}

export interface GoogleOAuth2 {
  initTokenClient: (config: GoogleTokenClientConfig) => { requestAccessToken: () => void };
  revoke: (token: string) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let pendingLoad: Promise<GoogleOAuth2> | null = null;

export function loadGoogleIdentity(): Promise<GoogleOAuth2> {
  const oauth2 = window.google?.accounts?.oauth2;
  if (typeof oauth2?.initTokenClient === 'function') return Promise.resolve(oauth2);
  if (pendingLoad) return pendingLoad;

  pendingLoad = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const fail = (message: string) => {
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const onLoad = () => {
      const loaded = window.google?.accounts?.oauth2;
      if (typeof loaded?.initTokenClient !== 'function') {
        fail('Google sign-in is unavailable. Try again.');
        return;
      }
      cleanup();
      resolve(loaded);
    };
    const onError = () => fail('Google sign-in could not load. Check your connection and try again.');
    const timeoutId = window.setTimeout(() => {
      fail('Google sign-in timed out while loading. Check your connection and try again.');
    }, LOAD_TIMEOUT_MS);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).finally(() => {
    pendingLoad = null;
  });

  return pendingLoad;
}

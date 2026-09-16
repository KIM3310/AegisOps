import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { GoogleImport } from '../components/GoogleImport';
import { GoogleExport } from '../components/GoogleExport';
import { DatasetExport } from '../components/DatasetExport';
import { loadGoogleIdentity, type GoogleOAuth2, type GoogleTokenClientConfig } from '../services/googleIdentity';

const sdkSelector = 'script[src="https://accounts.google.com/gsi/client"]';

describe('explicit Google sign-in', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let tokenConfig: GoogleTokenClientConfig;
  let requestAccessToken: Mock<() => void>;

  function makeOAuth2(): GoogleOAuth2 {
    return {
      initTokenClient: (config) => {
        tokenConfig = config;
        return { requestAccessToken };
      },
      revoke: vi.fn(),
    };
  }

  function getScript(): HTMLScriptElement {
    const script = document.querySelector<HTMLScriptElement>(sdkSelector);
    if (!script) throw new Error('Expected the Google Identity script.');
    return script;
  }

  function signInButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      ['Connect Google', 'Try Workspace demo', 'Connecting...'].includes(item.textContent ?? '')
    );
    if (!button) throw new Error('Expected a sign-in button.');
    return button;
  }

  async function clickSignIn(): Promise<void> {
    await act(async () => signInButton().click());
  }

  async function renderImport(): Promise<void> {
    await act(async () => root.render(React.createElement(GoogleImport, {
      onImportLogs: vi.fn(), onImportImages: vi.fn(), onClose: vi.fn(),
    })));
  }

  async function finishLoading(oauth2: GoogleOAuth2): Promise<void> {
    await act(async () => {
      window.google = { accounts: { oauth2 } };
      getScript().dispatchEvent(new Event('load'));
    });
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    requestAccessToken = vi.fn();
    sessionStorage.clear();
    delete window.google;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      document.querySelectorAll(sdkSelector).forEach((script) => script.dispatchEvent(new Event('error')));
    });
    container.remove();
    document.querySelectorAll(sdkSelector).forEach((script) => script.remove());
    delete window.google;
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not load Google until sign-in and never falls back to demo on SDK failure', async () => {
    await act(async () => {
      root.render(React.createElement(GoogleImport, {
        onImportLogs: vi.fn(), onImportImages: vi.fn(), onClose: vi.fn(),
      }));
    });
    expect(container.textContent).toContain('Connect Google');
    expect(document.querySelector(sdkSelector)).toBeNull();

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Connect Google')!;
    await act(async () => {
      button.click();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
    const script = document.querySelector(sdkSelector);
    expect(script?.getAttribute('src')).toBe('https://accounts.google.com/gsi/client');

    await act(async () => {
      script!.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Google sign-in could not load');
    expect(container.textContent).not.toContain('demo@aegisops.dev');
    expect(button.disabled).toBe(false);
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
  });

  it('retries a failed script and completes an OAuth token response without demo fallback', async () => {
    await renderImport();
    await clickSignIn();
    await act(async () => getScript().dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Google sign-in could not load');

    await clickSignIn();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const oauth2 = makeOAuth2();
    await finishLoading(oauth2);
    expect(tokenConfig.client_id).toBe('test-client-id');
    expect(tokenConfig.scope).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(requestAccessToken).toHaveBeenCalledTimes(1);

    const fetchProfile = vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: 'operator@example.test', name: 'Operator' })));
    vi.stubGlobal('fetch', fetchProfile);
    await act(async () => tokenConfig.callback({ access_token: 'test-access-token', expires_in: 3600 }));
    expect(container.textContent).toContain('operator@example.test');
    expect(sessionStorage.getItem('google_access_token')).toBe('test-access-token');
    expect(Number(sessionStorage.getItem('google_access_token_expires_at'))).toBe(Date.now() + 3_600_000);
    expect(fetchProfile).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer test-access-token' },
    });
    expect(container.textContent).not.toContain('Sandbox');
  });

  it('times out visibly and lets the user retry', async () => {
    await renderImport();
    await clickSignIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Google sign-in timed out while loading');
    expect(signInButton().disabled).toBe(false);
    expect(document.querySelector(sdkSelector)).toBeNull();
    expect(sessionStorage.getItem('google_access_token')).toBeNull();

    await clickSignIn();
    await finishLoading(makeOAuth2());
    await act(async () => tokenConfig.error_callback({ type: 'popup_closed' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Google sign-in was closed. Try again.');
  });

  it.each([
    ['popup_failed_to_open', 'Google sign-in could not open. Allow popups and try again.'],
    ['popup_closed', 'Google sign-in was closed. Try again.'],
  ])('clears loading and shows %s without authenticating', async (type, message) => {
    await renderImport();
    await clickSignIn();
    await finishLoading(makeOAuth2());
    await act(async () => tokenConfig.error_callback({ type }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(signInButton().disabled).toBe(false);
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
  });

  it.each([{ error: 'access_denied' }, {}])('rejects an unsuccessful token response %j', async (response) => {
    await renderImport();
    await clickSignIn();
    await finishLoading(makeOAuth2());
    await act(async () => tokenConfig.callback(response));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Google sign-in was not completed. Try again.');
    expect(signInButton().disabled).toBe(false);
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
  });

  it('handles a synchronous token-client failure visibly', async () => {
    window.google = { accounts: { oauth2: makeOAuth2() } };
    requestAccessToken.mockImplementation(() => { throw new Error('Popup blocked by the browser.'); });
    await renderImport();
    await clickSignIn();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Popup blocked by the browser.');
    expect(signInButton().disabled).toBe(false);
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
  });

  it('keeps the no-client-ID demo explicit and never requests Google', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const fetchRemote = vi.fn();
    vi.stubGlobal('fetch', fetchRemote);
    await renderImport();
    expect(container.textContent).toContain('Preview sample data. No Google account is connected.');
    expect(signInButton().textContent).toBe('Try Workspace demo');
    await clickSignIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(container.textContent).toContain('demo@aegisops.dev');
    expect(container.textContent).toContain('Sandbox');
    expect(sessionStorage.getItem('google_access_token')).toBe('demo_token');
    expect(document.querySelector(sdkSelector)).toBeNull();
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it('does not restore a demo session when Google is configured', async () => {
    sessionStorage.setItem('google_access_token', 'demo_token');
    sessionStorage.setItem('google_user', JSON.stringify({ email: 'demo@aegisops.dev', name: 'Demo SRE' }));
    await renderImport();
    expect(signInButton().textContent).toBe('Connect Google');
    expect(container.textContent).not.toContain('demo@aegisops.dev');
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
    expect(document.querySelector(sdkSelector)).toBeNull();
  });

  it('restores a valid session without loading the SDK', async () => {
    sessionStorage.setItem('google_access_token', 'restored-test-token');
    sessionStorage.setItem('google_user', JSON.stringify({ email: 'operator@example.test', name: 'Operator' }));
    sessionStorage.setItem('google_access_token_expires_at', String(Date.now() + 3_600_000));
    await renderImport();
    expect(container.textContent).toContain('operator@example.test');
    expect(container.textContent).not.toContain('Connect Google');
    expect(document.querySelector(sdkSelector)).toBeNull();
  });

  it('does not open a late popup after the sign-in dialog closes', async () => {
    await renderImport();
    await clickSignIn();
    await act(async () => root.render(null));
    const oauth2 = makeOAuth2();
    await finishLoading(oauth2);
    expect(requestAccessToken).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('google_access_token')).toBeNull();

    await renderImport();
    await clickSignIn();
    await act(async () => tokenConfig.error_callback({ type: 'popup_closed' }));
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Google sign-in was closed. Try again.');
  });

  it.each(['export', 'dataset'])('shows SDK failures in the %s dialog', async (dialog) => {
    const component = dialog === 'export'
      ? React.createElement(GoogleExport, {
        report: { title: 'Test report', summary: 'Test', severity: 'SEV2', rootCauses: [], timeline: [], actionItems: [], mitigationSteps: [], tags: [] },
        onClose: vi.fn(),
      })
      : React.createElement(DatasetExport, { incidents: [], onClose: vi.fn() });
    await act(async () => root.render(component));
    await clickSignIn();
    await act(async () => getScript().dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Google sign-in could not load');
    expect(signInButton().disabled).toBe(false);
    expect(sessionStorage.getItem('google_access_token')).toBeNull();
  });

  it('deduplicates concurrent loads and reuses the loaded SDK', async () => {
    const first = loadGoogleIdentity();
    const second = loadGoogleIdentity();
    expect(second).toBe(first);
    expect(document.querySelectorAll(sdkSelector)).toHaveLength(1);
    const oauth2 = makeOAuth2();
    await finishLoading(oauth2);
    expect(await first).toBe(oauth2);
    expect(await second).toBe(oauth2);
    expect(await loadGoogleIdentity()).toBe(oauth2);
    expect(document.querySelectorAll(sdkSelector)).toHaveLength(1);
  });

  it('joins an existing script rather than inserting a duplicate', async () => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    document.head.appendChild(script);
    const pending = loadGoogleIdentity();
    const oauth2 = makeOAuth2();
    await finishLoading(oauth2);
    expect(await pending).toBe(oauth2);
    expect(document.querySelectorAll(sdkSelector)).toHaveLength(1);
    expect(getScript()).toBe(script);
  });

  it('rejects a script that loads without OAuth2 and allows a new attempt', async () => {
    const pending = loadGoogleIdentity();
    const failure = expect(pending).rejects.toThrow('Google sign-in is unavailable. Try again.');
    getScript().dispatchEvent(new Event('load'));
    await failure;
    expect(document.querySelector(sdkSelector)).toBeNull();

    const retry = loadGoogleIdentity();
    const oauth2 = makeOAuth2();
    await finishLoading(oauth2);
    expect(await retry).toBe(oauth2);
  });
});

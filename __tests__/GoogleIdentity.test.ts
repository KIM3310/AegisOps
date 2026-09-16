import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
});

import { GoogleImport } from '../components/GoogleImport';

const sdkSelector = 'script[src="https://accounts.google.com/gsi/client"]';

describe('explicit Google sign-in', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelectorAll(sdkSelector).forEach((script) => script.remove());
    vi.useRealTimers();
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
});

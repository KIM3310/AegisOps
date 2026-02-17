import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendToChatWebhook } from '../services/ChatService';
import type { IncidentReport } from '../types';

const baseReport: IncidentReport = {
  title: 'DB latency spike',
  summary: 'Database p95 latency increased rapidly after deploy.',
  severity: 'SEV2',
  rootCauses: ['Connection pool exhaustion'],
  timeline: [{ time: '10:01', description: 'Latency alarm fired' }],
  actionItems: [{ task: 'Increase pool size', priority: 'HIGH' }],
  mitigationSteps: ['Rollback deployment'],
  tags: ['database', 'latency'],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sendToChatWebhook', () => {
  it('returns false for invalid webhook URL', async () => {
    const res = await sendToChatWebhook('not-a-url', baseReport);
    expect(res).toBe(false);
  });

  it('falls back to UNKNOWN severity emoji for unexpected values', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const report = { ...baseReport, severity: 'SEV9' as IncidentReport['severity'] };
    const ok = await sendToChatWebhook('https://chat.example.test/webhook', report);

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const parsed = JSON.parse(String(init?.body));
    expect(parsed.cards[0].header.title).toContain('⚪ [UNKNOWN]');
  });

  it('returns false on request timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('aborted');
          (abortErr as Error & { name: string }).name = 'AbortError';
          reject(abortErr);
        });
      });
    });

    const pending = sendToChatWebhook('https://chat.example.test/webhook', baseReport);
    await vi.advanceTimersByTimeAsync(10_100);
    await expect(pending).resolves.toBe(false);
  });
});

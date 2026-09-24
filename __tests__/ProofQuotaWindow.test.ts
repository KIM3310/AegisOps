// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { inSameQuotaMinute } from '../scripts/proof-quota-window';

describe('quota proof window', () => {
  it('returns the race result when setup and requests share a minute', async () => {
    const attempt = vi.fn(async () => [201, 429]);
    await expect(inSameQuotaMinute(attempt, () => 1000)).resolves.toEqual([201, 429]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('recreates the fixture after the minute rolls over during a race', async () => {
    const clock = [59999, 60001, 60002, 60003];
    const attempt = vi.fn().mockResolvedValueOnce([201, 201]).mockResolvedValueOnce([201, 429]);
    await expect(inSameQuotaMinute(attempt, () => clock.shift()!)).resolves.toEqual([201, 429]);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry unexpected statuses within a stable window', async () => {
    const attempt = vi.fn(async () => [201, 201]);
    await expect(inSameQuotaMinute(attempt, () => 1000)).resolves.toEqual([201, 201]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fails when every attempt crosses a boundary', async () => {
    let clock = 0;
    const attempt = vi.fn(async () => [201, 201]);
    await expect(inSameQuotaMinute(attempt, () => (clock += 60000))).rejects.toThrow('after three attempts');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('propagates fixture and transport failures without retrying', async () => {
    const attempt = vi.fn(async () => { throw new Error('fixture failed'); });
    await expect(inSameQuotaMinute(attempt, () => 1000)).rejects.toThrow('fixture failed');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

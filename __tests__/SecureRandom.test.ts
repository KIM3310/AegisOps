import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecureUuid } from '../utils/secureRandom';

describe('createSecureUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when it is available', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000');
    vi.stubGlobal('crypto', { randomUUID });

    expect(createSecureUuid()).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('uses getRandomValues for a standards-compliant UUID fallback', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const id = createSecureUuid();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('fails closed when secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => createSecureUuid()).toThrow('Secure random number generation is unavailable.');
  });
});

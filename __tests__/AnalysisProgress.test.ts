import { describe, expect, it } from 'vitest';
import { advanceAnalysisProgress } from '../utils/analysisProgress';

describe('advanceAnalysisProgress', () => {
  it('advances deterministically and stops at the pre-completion ceiling', () => {
    expect(advanceAnalysisProgress(0)).toBe(6);
    expect(advanceAnalysisProgress(87)).toBe(90);
    expect(advanceAnalysisProgress(90)).toBe(90);
  });
});

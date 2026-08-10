const ANALYSIS_PROGRESS_STEP = 6;
const ANALYSIS_PROGRESS_CEILING = 90;

/** Advances the simulated upload progress without using randomness. */
export function advanceAnalysisProgress(current: number): number {
  return Math.min(current + ANALYSIS_PROGRESS_STEP, ANALYSIS_PROGRESS_CEILING);
}

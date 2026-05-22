import type { RegressionEntry, SliceRegressionCheck } from '@/core/types/planning.js';

export interface RegressionRunResult {
  passed: boolean;
  detail?: string;
}

export type RegressionRunner = (entry: RegressionEntry) => Promise<RegressionRunResult>;

export async function verifySliceRegression(
  entries: RegressionEntry[],
  runRegression: RegressionRunner,
): Promise<SliceRegressionCheck[]> {
  const results: SliceRegressionCheck[] = [];

  for (const entry of entries) {
    const outcome = await runRegression(entry);
    results.push({
      entry_id: entry.entry_id,
      status: outcome.passed ? 'passing' : 'failing',
      passed: outcome.passed,
      detail: outcome.detail ?? (outcome.passed ? 'regression passed' : 'regression failed'),
    });
  }

  return results;
}

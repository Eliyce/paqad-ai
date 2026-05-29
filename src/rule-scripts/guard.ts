// Over-flagging guard for newly generated scripts (issue #89, edge case #9).
//
// A script that flags too large a fraction of existing in-scope files is more
// likely buggy than the codebase is broken. Before a script is accepted, it is
// dry-run across in-scope files and its flag rate is compared to a per-kind
// threshold. Exceeding it surfaces a Decision Pause packet rather than silently
// enforcing.

import { executeRuleScript } from './execute.js';
import type { VerifiabilityKind } from './types.js';

// Per-kind defaults (spec scope decision #7). deterministic scripts should be
// near-zero false positives; heuristic scripts are allowed a wider surface.
export const OVER_FLAG_THRESHOLDS: Record<'deterministic' | 'heuristic', number> = {
  deterministic: 0.05,
  heuristic: 0.2,
};

export interface OverFlagResult {
  files_checked: number;
  files_flagged: number;
  rate: number;
  threshold: number;
  exceeded: boolean;
}

export function checkOverFlag(
  scriptPath: string,
  kind: Exclude<VerifiabilityKind, 'unverifiable'>,
  projectRoot: string,
  files: string[],
  threshold: number = OVER_FLAG_THRESHOLDS[kind],
): OverFlagResult {
  let flagged = 0;
  for (const file of files) {
    const result = executeRuleScript(scriptPath, { projectRoot, files: [file] });
    if (result.ok && (result.report?.findings.length ?? 0) > 0) {
      flagged++;
    }
  }
  const checked = files.length;
  const rate = checked === 0 ? 0 : flagged / checked;
  return {
    files_checked: checked,
    files_flagged: flagged,
    rate,
    threshold,
    exceeded: rate > threshold,
  };
}

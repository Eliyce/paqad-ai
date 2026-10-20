import { executeRuleScript } from './execute.js';
import type { VerifiabilityKind } from './types.js';

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

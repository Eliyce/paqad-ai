// Rule-compliance evidence on the session-ledger (buildout F6 — the rule-report fold).
//
// Two project-scoped row kinds capture what the dashboard / SIEM read about rule
// compliance, mirroring the two engine caches that STAY (the engine reads them):
//   - `findings` — the deterministic/heuristic/skipped counts + blocking flag the
//     runner produces (mirrors `.paqad/scripts/rules/.cache/report.json`).
//   - `drift`    — the reconciler's `blocked` flag + RS-* counts (mirrors
//     `.paqad/scripts/rules/.cache/drift.json`).
// The latest row of each kind is the current state. Map COVERAGE stats are NOT
// folded here — they are derived live from the rule-script map, which stays.

import { readLatestProjectEvent, recordProjectEvent } from '@/session-ledger/project-ledger.js';

export const RULE_EVIDENCE_DOC_TYPE = 'rule-evidence';
export const RULE_EVIDENCE_SCHEMA_VERSION = 1;

export interface RuleFindingsEvidence {
  counts: { deterministic: number; heuristic: number; skipped: number };
  blocking: boolean;
}

export interface RuleDriftEvidence {
  blocked: boolean;
  /** RS-* finding-code counts; keys are RuleScriptFindingCode strings. */
  counts: Record<string, number>;
}

/** Record the latest rule-script run's finding counts (best-effort). */
export function recordRuleFindings(projectRoot: string, evidence: RuleFindingsEvidence): void {
  recordProjectEvent(
    projectRoot,
    RULE_EVIDENCE_DOC_TYPE,
    { kind: 'findings', counts: evidence.counts, blocking: evidence.blocking },
    RULE_EVIDENCE_SCHEMA_VERSION,
  );
}

/** Record the latest reconciler drift state (best-effort). */
export function recordRuleDrift(projectRoot: string, evidence: RuleDriftEvidence): void {
  recordProjectEvent(
    projectRoot,
    RULE_EVIDENCE_DOC_TYPE,
    { kind: 'drift', blocked: evidence.blocked, counts: evidence.counts },
    RULE_EVIDENCE_SCHEMA_VERSION,
  );
}

/** The latest recorded finding counts, or null when none recorded. */
export function readLatestRuleFindings(projectRoot: string): RuleFindingsEvidence | null {
  const row = readLatestProjectEvent(
    projectRoot,
    RULE_EVIDENCE_DOC_TYPE,
    (r) => r.kind === 'findings',
  );
  if (!row) {
    return null;
  }
  return {
    counts: row.counts as RuleFindingsEvidence['counts'],
    blocking: Boolean(row.blocking),
  };
}

/** The latest recorded drift state, or null when none recorded. */
export function readLatestRuleDrift(projectRoot: string): RuleDriftEvidence | null {
  const row = readLatestProjectEvent(
    projectRoot,
    RULE_EVIDENCE_DOC_TYPE,
    (r) => r.kind === 'drift',
  );
  if (!row) {
    return null;
  }
  return { blocked: Boolean(row.blocked), counts: (row.counts ?? {}) as Record<string, number> };
}

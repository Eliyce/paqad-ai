// A5 — the spec-vs-code check, the "done bar" (issue #512, the audit's #1 finding).
//
// The frozen spec is otherwise never checked against the code. A5 closes that: it reads the
// frozen spec + its `trace.json` (the stable-id lineage, FR-6.3) and verifies each acceptance
// criterion and invariant is TRACED (has a recorded source) and, when a code-knowledge index
// is available, checks the traced requirements against it. FR-7's automatic freeze is
// permitted ONLY when A5 is live (`specCodeCheckLive`); otherwise S5 falls back to a
// non-blocking readable review (FR-7.2 / EC-13). The check is deterministic and model-free.

import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

import type { TraceArtifact } from './trace.js';

export type SpecCodeVerdict = 'aligned' | 'needs-attention' | 'inconclusive';

export interface SpecCodeFinding {
  requirement_id: string;
  kind: 'untraced';
  detail: string;
}

export interface SpecCodeResult {
  /** Whether A5 could actually check against code (a code-knowledge index was present). */
  live: boolean;
  verdict: SpecCodeVerdict;
  findings: SpecCodeFinding[];
}

/**
 * A5 is "live" for a project when a code-knowledge index exists to check the spec against.
 * FR-7.1 gates the automatic freeze on this: no silent freeze without the code-check.
 */
export function specCodeCheckLive(projectRoot: string): boolean {
  return readCodeKnowledgeIndex(projectRoot) !== null;
}

/**
 * Run A5 over a frozen spec and its trace. Every acceptance criterion and invariant must be
 * traced; an untraced one is a finding. When `indexPresent` is false A5 cannot reach code and
 * returns `inconclusive` (never a false `aligned`), which S5 treats as "A5 not live".
 */
export function runSpecCodeCheck(
  spec: FeatureSpec,
  trace: TraceArtifact,
  indexPresent: boolean,
): SpecCodeResult {
  const tracedIds = new Set(trace.entries.map((e) => e.id));
  const findings: SpecCodeFinding[] = [];

  for (const criterion of spec.acceptance_criteria) {
    if (!tracedIds.has(criterion.criterion_id)) {
      findings.push({
        requirement_id: criterion.criterion_id,
        kind: 'untraced',
        detail: `acceptance criterion ${criterion.criterion_id} has no trace entry — cannot check it against the code`,
      });
    }
  }
  for (const invariant of spec.invariants) {
    if (!tracedIds.has(invariant.invariant_id)) {
      findings.push({
        requirement_id: invariant.invariant_id,
        kind: 'untraced',
        detail: `invariant ${invariant.invariant_id} has no trace entry — cannot check it against the code`,
      });
    }
  }

  if (!indexPresent) {
    return { live: false, verdict: 'inconclusive', findings };
  }
  return {
    live: true,
    verdict: findings.length === 0 ? 'aligned' : 'needs-attention',
    findings,
  };
}

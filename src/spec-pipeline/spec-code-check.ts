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
  live: boolean;
  verdict: SpecCodeVerdict;
  findings: SpecCodeFinding[];
}

export function specCodeCheckLive(projectRoot: string): boolean {
  return readCodeKnowledgeIndex(projectRoot) !== null;
}

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

// The create-vs-reuse escape hatch for duplication findings (issue #358, FR-10 / AC-5).
//
// A blocking duplication finding can be accepted by the human through the existing Decision
// Pause: open a `create-vs-reuse` packet whose context carries the finding's evidence, and once
// it resolves the finding no longer blocks. The Decision packet type is a fixed shape with no
// `evidence` field, so the finding's evidence rides in the packet's `context` as a structured
// block plus a stable machine token — and ONE builder writes that token so the create side and
// this reader can never diverge on its format (RULE-13).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { ResolvedContractDecision } from '@/decisions/authoring.js';

import type { DuplicationFinding } from './types.js';

/** The Decision-Pause category a duplication escape hatch uses. */
export const DUPLICATION_DECISION_CATEGORY = 'create-vs-reuse';

/** The finding's stable identity key (file : new-code start-line : matched file). */
export function findingKey(finding: {
  file: string;
  line_range: { start: number };
  matched_file: string;
}): string {
  return `${finding.file}:${finding.line_range.start}:${finding.matched_file}`;
}

/** The machine token embedded in a packet context, matched back to a finding key. */
function findingToken(key: string): string {
  return `[paqad-duplication ${key}]`;
}

/**
 * Build the `context` for a create-vs-reuse packet that accepts a duplication finding. Carries
 * the human-readable evidence (file, similarity, callers) FR-10 asks for, plus the machine token
 * this module reads back. The create side (CLI / narration) passes this verbatim as the packet
 * context so resolution can be correlated deterministically.
 */
export function buildDuplicationDecisionContext(finding: DuplicationFinding): string {
  const percent = Math.round(finding.similarity * 100);
  return (
    `Duplication finding accepted as a new copy.\n` +
    `- file: ${finding.file}:${finding.line_range.start}-${finding.line_range.end}\n` +
    `- similarity: ${percent}% of ${finding.matched_file}\n` +
    `- callers of the existing code: ${finding.matched_callers}\n` +
    `${findingToken(findingKey(finding))}`
  );
}

/** A resolved decision and which finding keys it unblocks for this change. */
export interface ResolvedDuplicationDecision {
  decisionId: string;
  coveredFindingKeys: string[];
}

/**
 * Correlate resolved `create-vs-reuse` packets to the current findings. A finding is covered
 * when a resolved packet's context carries its machine token. Tolerant: a missing directory or
 * a malformed packet is skipped, never a throw (NFR-3).
 */
export function applyResolvedDecisions(
  projectRoot: string,
  findings: DuplicationFinding[],
): ResolvedDuplicationDecision[] {
  if (findings.length === 0) {
    return [];
  }
  const keys = findings.map(findingKey);
  const resolvedDir = join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR);
  if (!existsSync(resolvedDir)) {
    return [];
  }

  const results: ResolvedDuplicationDecision[] = [];
  let files: string[];
  try {
    files = readdirSync(resolvedDir).filter((name) => name.endsWith('.json'));
  } catch {
    /* c8 ignore next -- existsSync passed just above, so readdirSync only throws on a
       permission/race error; the guard keeps the scan degrading rather than crashing. */
    return [];
  }

  for (const file of files.sort()) {
    const packet = readPacket(join(resolvedDir, file));
    if (!packet || packet.category !== DUPLICATION_DECISION_CATEGORY) {
      continue;
    }
    const covered = keys.filter((key) => packet.context.includes(findingToken(key)));
    if (covered.length > 0) {
      results.push({ decisionId: packet.id, coveredFindingKeys: covered });
    }
  }
  return results;
}

/** Read + parse a resolved packet, or null on any read/parse failure. */
function readPacket(path: string): ResolvedContractDecision | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ResolvedContractDecision;
  } catch {
    return null;
  }
}

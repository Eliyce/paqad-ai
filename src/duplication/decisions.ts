import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { ResolvedContractDecision } from '@/decisions/authoring.js';

import type { DuplicationFinding } from './types.js';

export const DUPLICATION_DECISION_CATEGORY = 'create-vs-reuse';

export function findingKey(finding: {
  file: string;
  line_range: { start: number };
  matched_file: string;
}): string {
  return `${finding.file}:${finding.line_range.start}:${finding.matched_file}`;
}

function findingToken(key: string): string {
  return `[paqad-duplication ${key}]`;
}

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

export interface ResolvedDuplicationDecision {
  decisionId: string;
  coveredFindingKeys: string[];
}

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

function readPacket(path: string): ResolvedContractDecision | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ResolvedContractDecision;
  } catch {
    return null;
  }
}

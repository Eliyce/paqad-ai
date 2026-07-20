import { describe, expect, it } from 'vitest';

import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import {
  applyResolvedDecisions,
  buildDuplicationDecisionContext,
  findingKey,
  DUPLICATION_DECISION_CATEGORY,
} from '@/duplication/decisions.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import { makeGitProject, writeProjectFile } from './helpers.js';

function finding(overrides: Partial<DuplicationFinding> = {}): DuplicationFinding {
  return {
    file: 'src/stamp.ts',
    line_range: { start: 12, end: 19 },
    matched_file: 'src/dates.ts',
    matched_symbol: 'formatIsoDate',
    matched_line_range: { start: 1, end: 8 },
    similarity: 0.93,
    matched_callers: 4,
    corroborated: false,
    kind: 'deterministic',
    message: 'msg',
    ...overrides,
  };
}

describe('findingKey / context', () => {
  it('keys a finding by file, start line, and matched file', () => {
    expect(findingKey(finding())).toBe('src/stamp.ts:12:src/dates.ts');
  });

  it('embeds the finding evidence and machine token in the context', () => {
    const context = buildDuplicationDecisionContext(finding());
    expect(context).toContain('similarity: 93%');
    expect(context).toContain('callers of the existing code: 4');
    expect(context).toContain('[paqad-duplication src/stamp.ts:12:src/dates.ts]');
  });
});

describe('applyResolvedDecisions', () => {
  it('returns nothing with no findings', () => {
    expect(applyResolvedDecisions(makeGitProject(), [])).toEqual([]);
  });

  it('returns nothing when no resolved packet references a finding', () => {
    const root = makeGitProject();
    expect(applyResolvedDecisions(root, [finding()])).toEqual([]);
  });

  it('correlates a resolved create-vs-reuse packet to its finding', () => {
    const root = makeGitProject();
    const created = createPendingDecision(root, {
      category: DUPLICATION_DECISION_CATEGORY,
      title: 'Accept the near-copy',
      context: buildDuplicationDecisionContext(finding()),
      options: [
        { option_key: 'reuse', label: 'Reuse it' },
        { option_key: 'accept', label: 'Accept the copy' },
      ],
    });
    resolvePendingDecision(root, created.id, 'accept', 'a good reason');

    const resolved = applyResolvedDecisions(root, [finding()]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.decisionId).toBe(created.id);
    expect(resolved[0]!.coveredFindingKeys).toEqual(['src/stamp.ts:12:src/dates.ts']);
  });

  it('skips a malformed resolved packet without throwing', () => {
    const root = makeGitProject();
    writeProjectFile(root, '.paqad/decisions/resolved/D-broken.json', 'not json{');
    expect(applyResolvedDecisions(root, [finding()])).toEqual([]);
  });

  it('ignores a resolved packet of another category', () => {
    const root = makeGitProject();
    const created = createPendingDecision(root, {
      category: 'architecture-path',
      title: 'unrelated',
      context: buildDuplicationDecisionContext(finding()),
      options: [
        { option_key: 'a', label: 'A' },
        { option_key: 'b', label: 'B' },
      ],
    });
    resolvePendingDecision(root, created.id, 'a');
    expect(applyResolvedDecisions(root, [finding()])).toEqual([]);
  });
});

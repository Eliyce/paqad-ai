import { describe, expect, it } from 'vitest';

import type { ChangeRuleApplicability } from '@/context/rule-context.js';
import type { RulesLoadedRecord } from '@/feature-evidence/rules-loaded.js';
import { rulesLoadedGate } from '@/verification/repository/rules-loaded-gate.js';

function applicability(overrides: Partial<ChangeRuleApplicability> = {}): ChangeRuleApplicability {
  return {
    applicable: [
      { rule_id: 'RULE-2', title: 'Constitution', always_load: true, matched_paths: [] },
    ],
    loadedRuleText: '### RULE-2 · Constitution\nbody',
    ruleTextHash: 'hash',
    changedPaths: ['src/a.ts'],
    hasStore: true,
    ...overrides,
  };
}

function record(ruleIds: string[]): RulesLoadedRecord {
  return {
    schema_version: 1,
    doc_type: 'paqad.rules-loaded',
    session_id: 'ses',
    adapter: 'claude-code',
    changed_files: ['src/a.ts'],
    applicable_rules: ruleIds.map((id) => ({
      rule_id: id,
      title: id,
      always_load: true,
      matched_paths: [],
    })),
    rule_text_hash: 'hash',
    artifact: '.paqad/context/session-context.md',
    created_at: '2026-09-12T00:00:00.000Z',
    content_hash: 'x',
  };
}

const base = { projectRoot: '/x', dirName: 'bundle', isFeatureDev: true };

describe('rulesLoadedGate', () => {
  it('resolves applicability for the owning session, the same one rules load used', async () => {
    const sessions: Array<string | null> = [];
    await rulesLoadedGate(
      { ...base, sessionId: 'ses-owner' },
      {
        resolveApplicability: async (_root, sessionId) => {
          sessions.push(sessionId);
          return applicability();
        },
        readRecord: () => record(['RULE-2']),
      },
    );
    await rulesLoadedGate(base, {
      resolveApplicability: async (_root, sessionId) => {
        sessions.push(sessionId);
        return applicability();
      },
      readRecord: () => record(['RULE-2']),
    });
    expect(sessions).toEqual(['ses-owner', null]);
  });

  it('returns null on a non-feature-development change', async () => {
    const gate = await rulesLoadedGate(
      { ...base, isFeatureDev: false },
      { resolveApplicability: async () => applicability(), readRecord: () => null },
    );
    expect(gate).toBeNull();
  });

  it('returns null when there is no active bundle', async () => {
    const gate = await rulesLoadedGate(
      { ...base, dirName: null },
      { resolveApplicability: async () => applicability(), readRecord: () => null },
    );
    expect(gate).toBeNull();
  });

  it('skips when there are no compiled rules', async () => {
    const gate = await rulesLoadedGate(base, {
      resolveApplicability: async () => applicability({ hasStore: false, applicable: [] }),
      readRecord: () => null,
    });
    expect(gate?.status).toBe('skipped');
  });

  it('AC-11: reads not required when no rule applies to the change', async () => {
    const gate = await rulesLoadedGate(base, {
      resolveApplicability: async () => applicability({ applicable: [] }),
      readRecord: () => null,
    });
    expect(gate?.status).toBe('skipped');
    expect(gate?.skip_kind).toBe('not-required');
  });

  it('FAILS when the rules were never loaded (no record)', async () => {
    const gate = await rulesLoadedGate(base, {
      resolveApplicability: async () => applicability(),
      readRecord: () => null,
    });
    expect(gate?.status).toBe('fail');
    expect(gate?.remediation).toContain('paqad-ai rules load');
  });

  it('reads not required at ci-backstop when no session loaded the rules', async () => {
    const gate = await rulesLoadedGate(
      { ...base, origin: 'ci-backstop' },
      { resolveApplicability: async () => applicability(), readRecord: () => null },
    );
    expect(gate).toMatchObject({
      name: 'rules-loaded',
      status: 'skipped',
      skip_kind: 'not-required',
      detail: 'No session loads rules on CI, so the load was not required here.',
      remediation: null,
    });
  });

  it('still fails a missing record at hook-completion and git-backstop', async () => {
    for (const origin of ['hook-completion', 'git-backstop'] as const) {
      const gate = await rulesLoadedGate(
        { ...base, origin },
        { resolveApplicability: async () => applicability(), readRecord: () => null },
      );
      expect(gate?.status).toBe('fail');
    }
  });

  it('still judges a record that exists at ci-backstop', async () => {
    const gate = await rulesLoadedGate(
      { ...base, origin: 'ci-backstop' },
      { resolveApplicability: async () => applicability(), readRecord: () => record(['RULE-2']) },
    );
    expect(gate?.status).toBe('pass');
  });

  it('is INCONCLUSIVE on a stale load (a newly applicable rule is uncovered)', async () => {
    const gate = await rulesLoadedGate(base, {
      resolveApplicability: async () =>
        applicability({
          applicable: [
            { rule_id: 'RULE-2', title: 'x', always_load: true, matched_paths: [] },
            { rule_id: 'RULE-13', title: 'y', always_load: false, matched_paths: ['src/a.ts'] },
          ],
        }),
      readRecord: () => record(['RULE-2']),
    });
    expect(gate?.status).toBe('inconclusive');
    expect(gate?.detail).toContain('RULE-13');
  });

  it('PASSES when the record covers the applicable rules', async () => {
    const gate = await rulesLoadedGate(base, {
      resolveApplicability: async () => applicability(),
      readRecord: () => record(['RULE-2']),
    });
    expect(gate?.status).toBe('pass');
  });

  it('phrases the fail and inconclusive detail in the plural for multiple rules', async () => {
    const many = applicability({
      applicable: [
        { rule_id: 'RULE-2', title: 'x', always_load: true, matched_paths: [] },
        { rule_id: 'RULE-13', title: 'y', always_load: false, matched_paths: ['src/a.ts'] },
      ],
    });
    const failGate = await rulesLoadedGate(base, {
      resolveApplicability: async () => many,
      readRecord: () => null,
    });
    expect(failGate?.detail).toContain('2 project rules apply');

    const staleGate = await rulesLoadedGate(base, {
      resolveApplicability: async () => many,
      readRecord: () => record([]),
    });
    expect(staleGate?.status).toBe('inconclusive');
    expect(staleGate?.detail).toContain('2 rules became');
  });
});

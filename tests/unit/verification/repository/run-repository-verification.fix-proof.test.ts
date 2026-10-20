import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import { appendFixProofRow, type FixProofRow } from '@/fix-protocol/fix-proof-record.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';

const SES = 'fix-proof-receipt-sess';

const roots: string[] = [];
function makeProject(kind?: 'fix' | 'other'): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-fix-proof-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'Fix the login crash',
    issue: null,
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
  if (kind) recordChangeConstants(root, dir, { kind });
  return { root, dir };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function row(phase: 'red' | 'green', outcome: FixProofRow['outcome']): FixProofRow {
  return {
    phase,
    outcome,
    test_file: 'tests/login.test.ts',
    test_id: 'login > empty password',
    command: 'pnpm vitest run tests/login.test.ts',
    exit_code: outcome === 'red' ? 1 : 0,
    timed_out: false,
    duration_ms: 10,
    commit: null,
    tree_dirty: null,
    at: '2026-01-01T00:00:00.000Z',
    reason: outcome,
    output_tail: [],
  };
}

function run(root: string) {
  const context = createVerificationContext({
    project_root: root,
    verification_origin: 'hook-completion',
    verification_stage: 'backstop-completion',
    changed_files: ['src/login.ts'],
  });
  ownInFlightChange(root, SES);
  return runRepositoryVerification({
    projectRoot: root,
    origin: 'hook-completion',
    prebuiltContext: { context, escalations: [] },
    hostSessionId: SES,
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

describe('runRepositoryVerification — fix-proof gate and receipt line', () => {
  it('reads Inconclusive with the missing step for a fix with no proof', async () => {
    const { root } = makeProject('fix');
    const verdict = await run(root);
    const gate = verdict.gates.find((g) => g.gate === 'fix-proof');
    expect(gate).toMatchObject({ status: 'inconclusive', skip_kind: 'did-not-run' });
    expect(verdict.kind).not.toBe('pass');
    expect(verdict.receipt).toContain('🟡 fix proof: no proof recorded');
    expect(verdict.summary).toContain('Fix proof did not run to the end');
  });

  it('recovers to a passing gate once red then green is recorded', async () => {
    const { root, dir } = makeProject('fix');
    appendFixProofRow(root, dir, row('green', 'green'));
    expect((await run(root)).receipt).toContain(
      '🟡 fix proof: passes, but never shown failing before the fix',
    );
    const { root: root2, dir: dir2 } = makeProject('fix');
    appendFixProofRow(root2, dir2, row('red', 'red'));
    appendFixProofRow(root2, dir2, row('green', 'green'));
    const verdict = await run(root2);
    expect(verdict.gates.find((g) => g.gate === 'fix-proof')?.status).toBe('pass');
    expect(verdict.receipt).toContain('🟢 fix proof: fails before the fix, passes after');
  });

  it('adds no receipt line and reads not required for a change that is not a fix', async () => {
    for (const kind of ['other', undefined] as const) {
      const { root } = makeProject(kind);
      const verdict = await run(root);
      expect(verdict.receipt).not.toContain('fix proof');
      expect(verdict.gates.find((g) => g.gate === 'fix-proof')).toMatchObject({
        status: 'skipped',
        skip_kind: 'not-required',
      });
    }
  });
});

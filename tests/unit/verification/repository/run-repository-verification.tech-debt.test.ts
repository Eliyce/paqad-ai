import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { appendRuleOverride, readRuleOverrides } from '@/feature-evidence/rule-overrides.js';
import { writeRuleStopRecord } from '@/hud/last-block.js';
import { applyRuleOverride } from '@/rule-scripts/override.js';
import { readFeatureTechDebtIndex } from '@/feature-evidence/tech-debt-index.js';
import { addDebtItem } from '@/tech-debt/index.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';

const SES = 'tech-debt-index-sess';
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

const roots: string[] = [];
function makeProject(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-tech-debt-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'A change',
    issue: null,
    ulid: ULID,
  });
  return { root, dir };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function run(root: string) {
  const context = createVerificationContext({
    project_root: root,
    verification_origin: 'hook-completion',
    verification_stage: 'backstop-completion',
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

describe('runRepositoryVerification — tech-debt.json index and receipt line', () => {
  it('indexes items raised by this change and names them on the receipt', async () => {
    const { root, dir } = makeProject();
    const raised = addDebtItem(root, {
      title: 'Found while building',
      kind: 'gap',
      severity: 'medium',
      files: [],
      foundIn: { change: ULID },
    });
    const verdict = await run(root);
    expect(readFeatureTechDebtIndex(root, dir)?.map((entry) => entry.id)).toEqual([raised.id]);
    expect(verdict.receipt).toContain(`🟡 tech debt: 1 item(s) raised (${raised.id})`);
  });

  it('adds no line and writes no index when the change raised nothing', async () => {
    const { root, dir } = makeProject();
    const verdict = await run(root);
    expect(verdict.receipt).not.toContain('tech debt');
    expect(existsSync(join(root, featureFilePath(dir, 'techDebt')))).toBe(false);
  });

  it('never lets an unreadable item store change the run', async () => {
    const { root, dir } = makeProject();
    mkdirSync(join(root, 'docs/instructions/tech-debt/TD-01JABCDEFGHJKMNPQRSTVWXYZ1.md'), {
      recursive: true,
    });
    const verdict = await run(root);
    expect(typeof verdict.ok).toBe('boolean');
    expect(existsSync(join(root, featureFilePath(dir, 'techDebt')))).toBe(false);
  });

  it('AC-18: an applied Allow once shows rule, file, who and time in rule-overrides.jsonl and on the receipt', async () => {
    const { root, dir } = makeProject();
    const at = () => new Date('2026-01-01T00:00:00.000Z');
    const { token } = writeRuleStopRecord({
      projectRoot: root,
      sessionId: SES,
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/a.ts',
      toolUseId: 'tu_1',
      managed: false,
      sole: true,
      now: at,
    });
    const applied = applyRuleOverride({
      projectRoot: root,
      sessionHint: SES,
      rule: 'RL-1',
      file: 'src/a.ts',
      token,
      toolUseId: 'tu_1',
      managedSettingsPaths: [join(root, 'no-managed.json')],
      now: at,
    });
    expect(applied.ok).toBe(true);
    expect(readRuleOverrides(root, dir)).toEqual([
      expect.objectContaining({
        rule: 'RL-1',
        file: 'src/a.ts',
        by: 'human',
        at: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    const verdict = await run(root);
    expect(verdict.receipt).toContain(
      '🟡 rule override: RL-1 on src/a.ts by human at 2026-01-01T00:00:00.000Z',
    );
  });

  it('names each rule override on the receipt', async () => {
    const { root, dir } = makeProject();
    appendRuleOverride(root, dir, {
      rule: 'RL-1',
      file: 'src/a.ts',
      toolUseId: 'tu_1',
      sessionId: SES,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const verdict = await run(root);
    expect(verdict.receipt).toContain(
      '🟡 rule override: RL-1 on src/a.ts by human at 2026-01-01T00:00:00.000Z',
    );
  });
});

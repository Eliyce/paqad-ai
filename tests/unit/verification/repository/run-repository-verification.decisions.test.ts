// Issue #581 (FR-11) — repository verification rewrites the change's decisions.json index from
// the tracked packets before the completeness gate reads the bundle, and a broken packet store
// never changes the run.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';

const SES = 'decisions-index-sess';
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const RESOLVED = '.paqad/decisions/resolved';

const roots: string[] = [];
function makeProject(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-decisions-'));
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

describe('runRepositoryVerification — decisions.json index (#581)', () => {
  it('indexes a decision resolved outside the decision verb', async () => {
    const { root, dir } = makeProject();
    mkdirSync(join(root, RESOLVED), { recursive: true });
    writeFileSync(
      join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAA1.json'),
      JSON.stringify({ id: 'D-01JAAAAAAAAAAAAAAAAAAAAAA1', category: 'ux-pattern', change: ULID }),
      'utf8',
    );
    await run(root);
    const index = JSON.parse(
      readFileSync(join(root, featureFilePath(dir, 'decisions')), 'utf8'),
    ) as { decisions: { id: string }[] };
    expect(index.decisions.map((entry) => entry.id)).toEqual(['D-01JAAAAAAAAAAAAAAAAAAAAAA1']);
  });

  it('never lets an unreadable packet store change the run', async () => {
    const { root, dir } = makeProject();
    // A directory where a packet file should be makes the index read fail inside the writer.
    mkdirSync(join(root, RESOLVED, 'D-01JAAAAAAAAAAAAAAAAAAAAAA2.json'), { recursive: true });
    const verdict = await run(root);
    expect(verdict).toBeDefined();
    expect(typeof verdict.ok).toBe('boolean');
    expect(existsSync(join(root, featureFilePath(dir, 'decisions')))).toBe(false);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adoptableInFlightOnBranch } from '@/feature-evidence/adoption';
import { appendFeatureStageRow, resolveActiveFeature } from '@/feature-evidence/stage-ledger';

const roots: string[] = [];
const clock = () => new Date('2026-09-21T00:00:00.000Z');

const BUNDLE_A = '567-first-change-01JABCDEFGHJKMNPQRSTVWXYZ0';
const BUNDLE_B = '567-second-change-01JABCDEFGHJKMNPQRSTVWXYZ1';
const BUNDLE_C = '567-other-branch-01JABCDEFGHJKMNPQRSTVWXYZ2';

/** A temp git repo on `main` with one commit, so readGitState resolves a real branch. */
function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-fork-guard-'));
  roots.push(root);
  const g = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.dev');
  g('config', 'user.name', 'Test');
  writeFileSync(join(root, 'a.txt'), 'a');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  return root;
}

function checkout(root: string, branch: string): void {
  execFileSync('git', ['checkout', '-q', '-b', branch], { cwd: root, stdio: 'ignore' });
}

/** Materialize an in-flight bundle (an `open` row, no close) on `branch`. */
function materialize(root: string, dirName: string, branch = 'main'): string {
  appendFeatureStageRow(
    root,
    'ses_open',
    dirName,
    { kind: 'open', adapter: 'claude-code', branch },
    clock,
  );
  return dirName;
}

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env.PAQAD_STAGE_ISOLATION;
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.PAQAD_STAGE_ISOLATION;
  else process.env.PAQAD_STAGE_ISOLATION = savedFlag;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('stage-isolation fork guard (issue #567, AC-9)', () => {
  it('refuses loudly to mint a third bundle when two are in flight on the branch (flag on)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    materialize(root, BUNDLE_B);
    process.env.PAQAD_STAGE_ISOLATION = 'on';

    expect(() => resolveActiveFeature(root, 'ses_new', { now: clock })).toThrow(
      /in-flight feature bundles|will not mint a third/i,
    );
  });

  it('with the flag off, the mint path is unchanged (mints, does not throw)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    materialize(root, BUNDLE_B);
    process.env.PAQAD_STAGE_ISOLATION = 'off';

    expect(() => resolveActiveFeature(root, 'ses_new', { now: clock })).not.toThrow();
  });

  it('a stale in-flight bundle on ANOTHER branch does not count (explicit branch wins)', () => {
    const root = tempRepo();
    // One in-flight on main, then move to a feature branch and open one there.
    materialize(root, BUNDLE_A, 'main');
    checkout(root, 'feature-x');
    materialize(root, BUNDLE_C, 'feature-x');

    // Only the current-branch bundle is in flight here — the main one is out of scope.
    const inFlight = adoptableInFlightOnBranch(root, 'ses_new', clock);
    expect(inFlight).toEqual([BUNDLE_C]);

    // So even with the flag on, there is exactly one in-flight → no fork error.
    process.env.PAQAD_STAGE_ISOLATION = 'on';
    expect(() => resolveActiveFeature(root, 'ses_new', { now: clock })).not.toThrow();
  });
});

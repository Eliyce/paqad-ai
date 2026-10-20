import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { adoptableInFlightOnBranch } from '@/feature-evidence/adoption';
import {
  appendFeatureStageRow,
  recordChangeConstants,
  resolveActiveFeature,
} from '@/feature-evidence/stage-ledger';

const roots: string[] = [];
const clock = () => new Date('2026-09-21T00:00:00.000Z');

const BUNDLE_A = '567-first-change-01JABCDEFGHJKMNPQRSTVWXYZ0';
const BUNDLE_B = '567-second-change-01JABCDEFGHJKMNPQRSTVWXYZ1';
const BUNDLE_C = '567-other-branch-01JABCDEFGHJKMNPQRSTVWXYZ2';

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

function materialize(root: string, dirName: string, branch = 'main'): string {
  recordChangeConstants(root, dirName, { adapter: 'claude-code', branch }, clock);
  appendFeatureStageRow(root, 'ses_open', dirName, { kind: 'open' }, clock);
  return dirName;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('stage-isolation fork guard', () => {
  it('refuses loudly to mint a third bundle when two are in flight on the branch', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    materialize(root, BUNDLE_B);

    expect(() => resolveActiveFeature(root, 'ses_new', { now: clock })).toThrow(
      /in-flight feature bundles|will not mint a third/i,
    );
  });

  it('an explicit change ref (--title) always mints, even with two in flight', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    materialize(root, BUNDLE_B);

    expect(() =>
      resolveActiveFeature(root, 'ses_new', { title: 'a deliberate new change', now: clock }),
    ).not.toThrow();
  });

  it('a stale in-flight bundle on ANOTHER branch does not count (explicit branch wins)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'main');
    checkout(root, 'feature-x');
    materialize(root, BUNDLE_C, 'feature-x');

    const inFlight = adoptableInFlightOnBranch(root, 'ses_new', clock);
    expect(inFlight).toEqual([BUNDLE_C]);

    expect(() => resolveActiveFeature(root, 'ses_new', { now: clock })).not.toThrow();
  });
});

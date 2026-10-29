import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFeatureChecks } from '@/checks/report-store.js';
import { reconcileDeliveryFromGit, recordShip } from '@/feature-evidence/delivery.js';
import { closeActiveFeature } from '@/feature-evidence/stage-ledger.js';
import { computeDoneLadder, type DoneLadderInput } from '@/hud/done-ladder.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';

import {
  checkout,
  cleanupScopeFixtures,
  commit,
  later,
  openChangeHere,
  repoRoot,
  runStage,
  writeGateRows,
  writeVerdict,
} from './scope-fixtures.js';

const S = 'ses-ladder';

afterEach(() => {
  vi.useRealTimers();
  cleanupScopeFixtures();
});

function stageLater(root: string, stage: string): void {
  const at = later(10_000);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  runStage(root, S, stage);
  vi.useRealTimers();
}

const DONE: DoneLadderInput = {
  workKind: 'pass',
  checks: 'green',
  uncommitted: true,
  commits: 0,
  prState: null,
  ci: null,
};

const rung = (over: Partial<DoneLadderInput>) => computeDoneLadder({ ...DONE, ...over });

describe('computeDoneLadder', () => {
  it('reads Done for a passing work verdict with green checks, even uncommitted', () => {
    expect(rung({})).toEqual({ rung: 'done', ci: null, ci_failed: false, uncommitted: true });
  });

  it('reads Committed once the edit is committed and the tree is clean', () => {
    expect(rung({ commits: 2, uncommitted: false }).rung).toBe('committed');
    expect(rung({ commits: 2, uncommitted: true }).rung).toBe('done');
    expect(rung({ commits: 2, uncommitted: null }).rung).toBe('done');
  });

  it('reads PR open while the PR is open and CI has not finished', () => {
    expect(rung({ commits: 1, uncommitted: false, prState: 'open', ci: 'pending' })).toMatchObject({
      rung: 'pr-open',
      ci: 'pending',
    });
  });

  it("holds at PR open on a green CI result, because merging is the owner's", () => {
    expect(rung({ prState: 'open', ci: 'pass' })).toMatchObject({ rung: 'pr-open', ci: 'pass' });
  });

  it('keeps the rung the work earned once the PR is merged, with no merge rung', () => {
    expect(rung({ prState: 'merged', ci: 'pass' }).rung).toBe('done');
    expect(rung({ prState: 'merged', commits: 2, uncommitted: false }).rung).toBe('committed');
    expect(rung({ prState: 'merged', workKind: 'fail' }).rung).toBeNull();
  });

  it('steps back from PR open when CI turns red', () => {
    expect(rung({ prState: 'open', ci: 'fail' })).toMatchObject({
      rung: 'committed',
      ci: 'fail',
      ci_failed: true,
    });
  });

  it('holds at PR open with CI unknown when the CI result cannot be read', () => {
    expect(rung({ prState: 'open', ci: null })).toMatchObject({ rung: 'pr-open', ci: 'unknown' });
    expect(rung({ prState: 'open', ci: 'unknown' })).toMatchObject({
      rung: 'pr-open',
      ci: 'unknown',
    });
  });

  it('reads the rung once the caller has found the work done, whatever the verdict word', () => {
    expect(rung({ workKind: 'inconclusive', workDone: true }).rung).toBe('done');
    expect(rung({ workKind: 'fail', workDone: true, checks: 'red' }).rung).toBeNull();
  });

  it('reads no rung without a passing work verdict or without green checks', () => {
    expect(rung({ workKind: 'fail' }).rung).toBeNull();
    expect(rung({ workKind: 'inconclusive' }).rung).toBeNull();
    expect(rung({ workKind: null }).rung).toBeNull();
    expect(rung({ checks: 'red' }).rung).toBeNull();
    expect(rung({ checks: 'unknown' }).rung).toBeNull();
  });
});

function finishGreen(root: string, kind: 'pass' | 'inconclusive' = 'pass'): string {
  checkout(root, 'feat/ladder', true);
  const dir = openChangeHere(root, S, 'ORD-9 ladder change', 'fast');
  for (const stage of ['planning', 'development', 'checks']) runStage(root, S, stage);
  writeFileSync(join(root, 'feature.ts'), 'export const x = 1;\n');
  const judged = later(1_000);
  writeGateRows(root, dir, [
    { code: 'code-tests-lint', verdict: 'pass', at: judged.toISOString() },
  ]);
  writeVerdict(root, S, kind, judged);
  closeActiveFeature(root, S);
  return dir;
}

function prOn(root: string, dir: string, sha: string, ci: 'pass' | 'fail' | 'pending' | null) {
  recordShip(
    root,
    dir,
    {
      push: { state: 'pushed', branch: 'feat/ladder', sha },
      pr: {
        number: 7,
        url: 'https://example.test/pull/7',
        draft: false,
        state: 'open',
        head_sha: sha,
      },
      ...(ci
        ? { ci: { sha, state: ci, done: 1, total: 1, reason: null, source: 'stop-check' } }
        : {}),
    } as never,
    later(2_000).toISOString(),
  );
}

describe('a finished change on the HUD', () => {
  it('AC-1, AC-9: a passing run keeps the closed change on screen as finished and Done', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.scope).toEqual({ qualified: true, reason: 'finished' });
    expect(snapshot.active).toBe(true);
    expect(snapshot.change?.dir).toBe(dir);
    expect(snapshot.verdict).toMatchObject({ kind: 'pass', change: dir });
    expect(snapshot.rung).toBe('done');
  });

  it('AC-20: an inconclusive close stays on screen with its inconclusive result and no rung', () => {
    const root = repoRoot();
    finishGreen(root, 'inconclusive');
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.scope.reason).toBe('finished');
    expect(snapshot.verdict?.kind).toBe('inconclusive');
    expect(snapshot.rung).toBeUndefined();
  });

  it('gives way once a new change on the same session and branch is open', () => {
    const root = repoRoot();
    const first = finishGreen(root);
    const next = openChangeHere(root, S, 'ORD-10 next change', 'fast');
    runStage(root, S, 'planning');
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.scope.reason).toBe('qualified');
    expect(snapshot.change?.dir).toBe(next);
    expect(snapshot.change?.dir).not.toBe(first);
  });

  it('never shows a finished change from another branch', () => {
    const root = repoRoot();
    finishGreen(root);
    checkout(root, 'feat/elsewhere', true);
    expect(buildHudSnapshot(root, S).scope).toEqual({
      qualified: false,
      reason: 'no-active-change',
    });
  });
});

describe('the done ladder on the snapshot', () => {
  it('AC-2: a passing checks row after the verdict keeps it fresh and the rung at Done', () => {
    const root = repoRoot();
    finishGreen(root);
    stageLater(root, 'checks');
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.verdict?.kind).toBe('pass');
    expect(snapshot.verdict_stale).toBeUndefined();
    expect(snapshot.rung).toBe('done');
  });

  it('AC-16: a later edit on the same change marks the verdict stale and drops Done', () => {
    const root = repoRoot();
    finishGreen(root);
    stageLater(root, 'development');
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.verdict).toBeNull();
    expect(snapshot.verdict_stale).toBe(true);
    expect(snapshot.rung).toBeUndefined();
  });

  it('AC-11, AC-18: a commit of the edit re-judges the rung to Committed with no new turn', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    expect(buildHudSnapshot(root, S).rung).toBe('done');
    commit(root, 'feature.ts', 'feat: ladder');
    reconcileDeliveryFromGit(root, dir, later(1_500).toISOString());
    expect(buildHudSnapshot(root, S).rung).toBe('committed');
  });

  it('AC-12, AC-13, AC-14: PR open, still PR open on green CI, then the merged PR keeps Committed', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    const sha = commit(root, 'feature.ts', 'feat: ladder');
    reconcileDeliveryFromGit(root, dir, later(1_500).toISOString());
    prOn(root, dir, sha, 'pending');
    expect(buildHudSnapshot(root, S).rung).toBe('pr-open');
    prOn(root, dir, sha, 'pass');
    expect(buildHudSnapshot(root, S).rung).toBe('pr-open');
    recordShip(root, dir, { pr: { state: 'merged' } } as never, later(3_000).toISOString());
    const merged = buildHudSnapshot(root, S);
    expect(merged.rung).toBe('committed');
    expect(merged.headline.text).not.toMatch(/merge/i);
    expect(merged.change?.dir).toBe(dir);
  });

  it('AC-15: CI turning red steps the rung back from PR open', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    const sha = commit(root, 'feature.ts', 'feat: ladder');
    reconcileDeliveryFromGit(root, dir, later(1_500).toISOString());
    prOn(root, dir, sha, 'fail');
    expect(buildHudSnapshot(root, S).rung).toBe('committed');
  });

  it('AC-17: an unreadable CI result holds the rung at PR open', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    const sha = commit(root, 'feature.ts', 'feat: ladder');
    reconcileDeliveryFromGit(root, dir, later(1_500).toISOString());
    prOn(root, dir, sha, null);
    expect(buildHudSnapshot(root, S).rung).toBe('pr-open');
  });

  it('AC-18: a later checks run moves the rung to red or back to Done, never to stale', () => {
    const root = repoRoot();
    const dir = finishGreen(root);
    const report = (passed: boolean, at: Date) =>
      writeFeatureChecks(root, dir, {
        schema_version: 2,
        generated_at: at.toISOString(),
        passed,
        ran: true,
        results: [],
      });
    report(false, later(5_000));
    const red = buildHudSnapshot(root, S);
    expect(red.rung).toBeUndefined();
    expect(red.verdict_stale).toBeUndefined();
    report(true, later(6_000));
    expect(buildHudSnapshot(root, S).rung).toBe('done');
  });
});

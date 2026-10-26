import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendCommitToFeature,
  commitsSinceBase,
  featureDeliveryBranch,
  mergeCi,
  readFeatureDelivery,
  recordShip,
  reconcileDeliveryFromGit,
  recordCommitForBranch,
  resolveDeliveryFeatureByBranch,
  stampMergeCommit,
  writeFeatureDelivery,
} from '@/feature-evidence/delivery.js';
import { readFeatureRecord, updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { forkBranchOf } from '@/rag/git-state.js';
import { mkdirSync } from 'node:fs';

const roots: string[] = [];
function tempRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-delivery-'));
  roots.push(r);
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: r, stdio: ['ignore', 'ignore', 'ignore'] });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.dev');
  g('config', 'user.name', 'Test');
  writeFileSync(join(r, 'a.txt'), 'a');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  return r;
}
function gitOut(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const AT = '2026-07-10T00:00:00.000Z';

describe('delivery.json read/write/append', () => {
  it('appends commits deduped by sha and tracks head', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendCommitToFeature(root, dir, { sha: 'aaa', subject: 'feat: one' }, AT);
    appendCommitToFeature(root, dir, { sha: 'aaa', subject: 'feat: one (dup)' }, AT);
    appendCommitToFeature(root, dir, { sha: 'bbb', subject: 'feat: two' }, AT);
    const record = readFeatureDelivery(root, dir);
    expect(record.commits.map((c) => c.sha)).toEqual(['aaa', 'bbb']);
    expect(record.head_sha).toBe('bbb');
  });

  it('reads a fresh empty record when delivery.json is absent', () => {
    const record = readFeatureDelivery(tempRepo(), 'nope-01JABCDEFGHJKMNPQRSTVWXYZ0');
    expect(record.commits).toEqual([]);
    expect(record.head_sha).toBeNull();
    expect(record).not.toHaveProperty('branch');
  });

  it('reads a fresh empty record when delivery.json is valid JSON but not a delivery record', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 2 });
    const full = join(root, featureFilePath(dir, 'delivery'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'null');
    const record = readFeatureDelivery(root, dir);
    expect(record.commits).toEqual([]);
    expect(record.head_sha).toBeNull();
  });
});

describe('local-git reads', () => {
  it('commitsSinceBase returns the branch commits newest-first', () => {
    const root = tempRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd: root });
    writeFileSync(join(root, 'b.txt'), 'b');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'feat: add b'], { cwd: root });
    const commits = commitsSinceBase(root, 'main');
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: add b');
  });

  it('commitsSinceBase returns [] on a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-nogit-'));
    roots.push(dir);
    expect(commitsSinceBase(dir, 'main')).toEqual([]);
  });

  it('reconcileDeliveryFromGit backfills branch + commit trail from local git', () => {
    const root = tempRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'feat/y'], { cwd: root });
    writeFileSync(join(root, 'c.txt'), 'c');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'feat: add c'], { cwd: root });
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    updateFeatureRecord(root, dir, { branch: null, base_branch: null });
    const record = reconcileDeliveryFromGit(root, dir, AT);
    expect(readFeatureRecord(root, dir)).toMatchObject({ branch: 'feat/y', base_branch: 'main' });
    expect(record).not.toHaveProperty('branch');
    expect(record.recorded_at).toBe(AT);
    expect(record.commits.some((c) => c.subject === 'feat: add c')).toBe(true);
    expect(record.head_sha).toBe(gitOut(root, 'rev-parse', 'HEAD'));
  });
});

describe('branch resolution + commit recording', () => {
  it('resolves a feature by its recorded branch, active winning a shared-branch tie', () => {
    const root = tempRepo();
    const a = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const b = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'B',
      issue: null,
      ulidSeed: 2,
    });
    updateFeatureRecord(root, a, { branch: 'feat/shared' });
    updateFeatureRecord(root, b, { branch: 'feat/shared' });
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(b);
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared', a)).toBe(a);
    expect(resolveDeliveryFeatureByBranch(root, 'feat/none')).toBeNull();
  });

  it('recordCommitForBranch attaches HEAD to the active feature and stamps the branch', () => {
    const root = tempRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'feat/z'], { cwd: root });
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const head = gitOut(root, 'rev-parse', 'HEAD');
    const recorded = recordCommitForBranch(root, dir, { sha: head, subject: 'feat: z' }, AT);
    expect(recorded).toBe(dir);
    const record = readFeatureDelivery(root, dir);
    expect(readFeatureRecord(root, dir)!.branch).toBe('feat/z');
    expect(record.commits[0].sha).toBe(head);
  });

  it('recordCommitForBranch stamps the branch on a feature.json that has none', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    execFileSync('git', ['checkout', '-q', '-b', 'feat/late'], { cwd: root });
    updateFeatureRecord(root, dir, { branch: null });
    const head = gitOut(root, 'rev-parse', 'HEAD');
    expect(recordCommitForBranch(root, dir, { sha: head, subject: 'feat: late' }, AT)).toBe(dir);
    expect(readFeatureRecord(root, dir)!.branch).toBe('feat/late');
  });

  it('writeFeatureDelivery drops the legacy branch fields of a record read from an old file', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const written = writeFeatureDelivery(
      root,
      dir,
      { ...readFeatureDelivery(root, dir), branch: 'old', base_branch: 'x', captured_at: AT },
      AT,
      'ses_2',
    );
    expect(written).toMatchObject({ session_id: 'ses_2', recorded_at: AT });
    const raw = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'delivery')), 'utf8'));
    expect(raw).not.toHaveProperty('branch');
    expect(raw).not.toHaveProperty('base_branch');
    expect(raw).not.toHaveProperty('captured_at');
  });

  it('writeFeatureDelivery copies a legacy branch and base to feature.json when it has none', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    updateFeatureRecord(root, dir, { branch: null, base_branch: null });
    writeFeatureDelivery(
      root,
      dir,
      { ...readFeatureDelivery(root, dir), branch: 'feat/old', base_branch: 'develop' },
      AT,
    );
    expect(readFeatureRecord(root, dir)).toMatchObject({
      branch: 'feat/old',
      base_branch: 'develop',
    });
    expect(featureDeliveryBranch(root, dir)).toBe('feat/old');
  });

  it('writeFeatureDelivery never overwrites the branch feature.json already has', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    updateFeatureRecord(root, dir, { branch: 'feat/new', base_branch: null });
    writeFeatureDelivery(
      root,
      dir,
      { ...readFeatureDelivery(root, dir), branch: 'feat/old', base_branch: 'develop' },
      AT,
    );
    expect(readFeatureRecord(root, dir)).toMatchObject({
      branch: 'feat/new',
      base_branch: 'develop',
    });

    updateFeatureRecord(root, dir, { base_branch: 'main' });
    writeFeatureDelivery(root, dir, { ...readFeatureDelivery(root, dir), base_branch: 'x' }, AT);
    expect(readFeatureRecord(root, dir)).toMatchObject({ branch: 'feat/new', base_branch: 'main' });
  });

  it('recordCommitForBranch returns null when no feature can be resolved', () => {
    const root = tempRepo();
    expect(recordCommitForBranch(root, null, { sha: 'x', subject: 's' }, AT)).toBeNull();
  });

  it('stampMergeCommit records the merge commit', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    stampMergeCommit(root, dir, 'merge-sha', AT);
    expect(readFeatureDelivery(root, dir).merge_commit).toBe('merge-sha');
  });
});

describe('what ships', () => {
  const ci = (state: 'pass' | 'fail' | 'pending' | 'unknown', sha = 'sha-x') => ({
    sha,
    state,
    done: 1,
    total: 2,
    reason: state === 'unknown' ? 'gh is signed out' : null,
    source: 'ci-gate' as const,
  });

  it('records the start commit and the commit split when the change opens', () => {
    const root = tempRepo();
    const head = gitOut(root, 'rev-parse', 'HEAD');
    execFileSync('git', ['checkout', '-q', '-b', 'feat/ORD-470-x'], { cwd: root });
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 3 });
    const record = readFeatureDelivery(root, dir);
    expect(record.start_commit).toBe(head);
    expect(record.commit_split).toMatchObject({ state: 'known', reason: null });
  });

  it('refreshes the split on reconcile so a later own commit counts as own', () => {
    const root = tempRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'feat/ORD-482-x'], { cwd: root });
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 4 });
    writeFileSync(join(root, 'b.txt'), 'b');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'feat(ORD-482): work'], { cwd: root });
    const record = reconcileDeliveryFromGit(root, dir, AT);
    expect(record.commit_split?.own).toMatchObject({ count: 1, tickets: ['ORD-482'] });
    expect(record.commit_split?.inherited?.count).toBe(0);
  });

  it('merges push, PR and CI field by field and keeps the rest of the record', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 5 });
    appendCommitToFeature(root, dir, { sha: 'aaa', subject: 'feat: one' }, AT);
    recordShip(root, dir, { push: { state: 'pushed', branch: 'feat/x', sha: 'aaa' } }, AT);
    recordShip(
      root,
      dir,
      { pr: { number: 12, url: 'https://example.test/pull/12', draft: true } },
      AT,
    );
    recordShip(root, dir, { pr: { draft: false } }, AT);
    recordShip(root, dir, { ci: ci('pending') }, AT);
    const record = readFeatureDelivery(root, dir);
    expect(record.commits).toHaveLength(1);
    expect(record.push).toMatchObject({ state: 'pushed', sha: 'aaa' });
    expect(record.pr).toMatchObject({
      number: 12,
      draft: false,
      url: 'https://example.test/pull/12',
    });
    expect(record.ci).toMatchObject({ state: 'pending', done: 1, total: 2 });
  });

  it('never moves CI backwards for the same head commit', () => {
    expect(mergeCi(ci('pass'), ci('pending')).state).toBe('pass');
    expect(mergeCi(ci('fail'), ci('unknown')).state).toBe('fail');
    expect(mergeCi(ci('pending'), ci('unknown')).state).toBe('pending');
    expect(mergeCi(ci('pending'), ci('pass')).state).toBe('pass');
    expect(mergeCi(ci('pass'), ci('pending', 'sha-y'))).toMatchObject({
      state: 'pending',
      sha: 'sha-y',
    });
    expect(mergeCi(null, ci('unknown'))).toMatchObject({
      state: 'unknown',
      reason: 'gh is signed out',
    });
  });

  it('AC-33: keeps a recorded pass when a later read for the same commit is pending', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 6 });
    recordShip(root, dir, { ci: ci('pass') }, AT);
    recordShip(root, dir, { ci: ci('pending') }, AT);
    expect(readFeatureDelivery(root, dir).ci?.state).toBe('pass');
  });
});

describe('the change start point (hud-live-run-truth)', () => {
  const g = (root: string, ...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });

  it('records the working tree as it stood at open, once', () => {
    const root = tempRepo();
    writeFileSync(join(root, 'local.txt'), 'untracked before open');
    rmSync(join(root, 'a.txt'));
    const dir = openFeatureChange(root, 'ses-wt', {
      adapter: 'claude-code',
      title: 'wt',
      issue: null,
    });
    const delivery = readFeatureDelivery(root, dir);
    expect(delivery.start_worktree).toEqual({
      'a.txt': 'deleted',
      'local.txt': expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    writeFileSync(join(root, 'later.txt'), 'after open');
    writeFeatureDelivery(root, dir, readFeatureDelivery(root, dir));
    expect(Object.keys(readFeatureDelivery(root, dir).start_worktree ?? {})).toEqual([
      'a.txt',
      'local.txt',
    ]);
  });

  it('forkBranchOf names the branch a branch was cut from, through Created from HEAD', () => {
    const root = tempRepo();
    g(root, 'checkout', '-q', '-b', 'release');
    writeFileSync(join(root, 'r.txt'), 'r');
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'feat: release work');
    g(root, 'checkout', '-q', '-b', 'feat/next');
    expect(forkBranchOf(root, 'feat/next')).toBe('release');
    g(root, 'branch', 'feat/direct', 'main');
    expect(forkBranchOf(root, 'feat/direct')).toBe('main');
    expect(forkBranchOf(root, 'main')).toBeNull();
  });
});

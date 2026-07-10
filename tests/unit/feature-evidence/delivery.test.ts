import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendCommitToFeature,
  commitsSinceBase,
  readFeatureDelivery,
  reconcileDeliveryFromGit,
  recordCommitForBranch,
  resolveDeliveryFeatureByBranch,
  stampMergeCommit,
  writeFeatureDelivery,
} from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

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
    expect(record.branch).toBeNull();
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
    const record = reconcileDeliveryFromGit(root, dir, AT);
    expect(record.branch).toBe('feat/y');
    expect(record.base_branch).toBe('main');
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
    writeFeatureDelivery(root, a, { ...readFeatureDelivery(root, a), branch: 'feat/shared' });
    writeFeatureDelivery(root, b, { ...readFeatureDelivery(root, b), branch: 'feat/shared' });
    // No active hint → most-recent (b sorts last by ULID seed 2 > 1).
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(b);
    // Active hint wins the tie.
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared', a)).toBe(a);
    expect(resolveDeliveryFeatureByBranch(root, 'feat/none')).toBeNull();
  });

  it('recordCommitForBranch attaches HEAD to the active feature and stamps the branch', () => {
    const root = tempRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'feat/z'], { cwd: root });
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    const head = gitOut(root, 'rev-parse', 'HEAD');
    const recorded = recordCommitForBranch(root, 'ses_1', { sha: head, subject: 'feat: z' }, AT);
    expect(recorded).toBe(dir);
    const record = readFeatureDelivery(root, dir);
    expect(record.branch).toBe('feat/z');
    expect(record.commits[0].sha).toBe(head);
  });

  it('recordCommitForBranch returns null when no feature can be resolved', () => {
    const root = tempRepo();
    expect(recordCommitForBranch(root, 'ses_empty', { sha: 'x', subject: 's' }, AT)).toBeNull();
  });

  it('stampMergeCommit records the merge commit', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    stampMergeCommit(root, dir, 'merge-sha', AT);
    expect(readFeatureDelivery(root, dir).merge_commit).toBe('merge-sha');
  });
});

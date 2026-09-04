import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  emptyCommitDecision,
  readFeatureDelivery,
  recordLinkAttempt,
  resolveDeliveryFeatureByBranch,
  seedFeatureDelivery,
  setCommitDecision,
} from '@/feature-evidence/delivery.js';
import { seedFeatureRecord, updateFeatureRecord } from '@/feature-evidence/feature-record.js';

const roots: string[] = [];
function tempRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-delivery-511-'));
  roots.push(r);
  execFileSync('git', ['init', '-q'], { cwd: r });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: r });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: r });
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const AT = '2026-09-04T00:00:00.000Z';
const DIR_A = 'a-thing-01JABCDEFGHJKMNPQRSTVWXYZ0';
const DIR_B = 'b-thing-01JABCDEFGHJKMNPQRSTVWXYZ9'; // higher ULID → newer

describe('seedFeatureDelivery', () => {
  it('seeds branch + base + default commit_decision at open', () => {
    const root = tempRepo();
    const record = seedFeatureDelivery(root, DIR_A, {
      branch: 'feat/x',
      baseBranch: 'main',
      capturedAt: AT,
    });
    expect(record.branch).toBe('feat/x');
    expect(record.base_branch).toBe('main');
    expect(record.commit_decision).toEqual(emptyCommitDecision());
    expect(readFeatureDelivery(root, DIR_A).branch).toBe('feat/x');
  });

  it('only back-fills a still-null branch, never clobbering an existing one', () => {
    const root = tempRepo();
    seedFeatureDelivery(root, DIR_A, { branch: 'feat/x', baseBranch: 'main', capturedAt: AT });
    const again = seedFeatureDelivery(root, DIR_A, {
      branch: 'feat/other',
      baseBranch: 'develop',
      capturedAt: AT,
    });
    expect(again.branch).toBe('feat/x');
    expect(again.base_branch).toBe('main');
  });
});

describe('setCommitDecision (AC-4)', () => {
  it('records user-requested as not-asked', () => {
    const root = tempRepo();
    const r = setCommitDecision(root, DIR_A, 'user-requested', AT);
    expect(r.commit_decision).toEqual({ asked: false, answer: 'user-requested', recorded_at: AT });
  });

  it.each(['commit', 'decline', 'ignored'] as const)('records asked=%s answer', (answer) => {
    const root = tempRepo();
    const r = setCommitDecision(root, DIR_A, answer, AT);
    expect(r.commit_decision).toEqual({ asked: true, answer, recorded_at: AT });
    expect(readFeatureDelivery(root, DIR_A).commit_decision!.answer).toBe(answer);
  });
});

describe('recordLinkAttempt (RC-2.6)', () => {
  it('stamps a one-line reason on the bundle', () => {
    const root = tempRepo();
    const r = recordLinkAttempt(root, DIR_A, 'commit deadbeef not linked', AT);
    expect(r.last_link_attempt).toBe(`${AT}: commit deadbeef not linked`);
  });
});

describe('resolveDeliveryFeatureByBranch status tie-break (RC-2.3)', () => {
  it('prefers the not-done bundle over a done one on the same branch', () => {
    const root = tempRepo();
    seedFeatureDelivery(root, DIR_A, { branch: 'feat/shared', baseBranch: 'main', capturedAt: AT });
    seedFeatureDelivery(root, DIR_B, { branch: 'feat/shared', baseBranch: 'main', capturedAt: AT });
    // B is newer but done; A is older but active → A wins.
    seedFeatureRecord(root, DIR_A, { adapter: 'a', sessionId: 's', now: () => new Date(AT) });
    seedFeatureRecord(root, DIR_B, { adapter: 'a', sessionId: 's', now: () => new Date(AT) });
    updateFeatureRecord(root, DIR_B, { status: 'done' }, () => new Date(AT));
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(DIR_A);
  });

  it('falls back to the newest when every match is done', () => {
    const root = tempRepo();
    seedFeatureDelivery(root, DIR_A, { branch: 'feat/shared', baseBranch: 'main', capturedAt: AT });
    seedFeatureDelivery(root, DIR_B, { branch: 'feat/shared', baseBranch: 'main', capturedAt: AT });
    seedFeatureRecord(root, DIR_A, { adapter: 'a', sessionId: 's', now: () => new Date(AT) });
    seedFeatureRecord(root, DIR_B, { adapter: 'a', sessionId: 's', now: () => new Date(AT) });
    updateFeatureRecord(root, DIR_A, { status: 'done' }, () => new Date(AT));
    updateFeatureRecord(root, DIR_B, { status: 'done' }, () => new Date(AT));
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(DIR_B);
  });
});

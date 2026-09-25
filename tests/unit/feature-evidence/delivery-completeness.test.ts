import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  emptyCommitDecision,
  featureDeliveryBranch,
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

/** Seed a bundle on `branch` the way the open path does: the branch lives on feature.json. */
function seedOnBranch(root: string, dirName: string, branch: string): void {
  seedFeatureRecord(root, dirName, {
    adapter: 'a',
    sessionId: 's',
    branch,
    baseBranch: 'main',
    now: () => new Date(AT),
  });
  seedFeatureDelivery(root, dirName, { sessionId: 's', recordedAt: AT });
}

describe('seedFeatureDelivery', () => {
  it('seeds the envelope header + default commit_decision at open, with no branch fields', () => {
    const root = tempRepo();
    const record = seedFeatureDelivery(root, DIR_A, { sessionId: 'ses_1', recordedAt: AT });
    expect(record).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.delivery',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_1',
      recorded_at: AT,
    });
    expect(record.commit_decision).toEqual(emptyCommitDecision());
    const raw = JSON.parse(
      readFileSync(join(root, '.paqad/ledger/feature-evidence', DIR_A, 'delivery.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(raw).slice(0, 6)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
    ]);
    expect(raw).not.toHaveProperty('branch');
    expect(raw).not.toHaveProperty('base_branch');
    expect(raw).not.toHaveProperty('captured_at');
  });

  it('keeps an existing commit decision on a re-seed', () => {
    const root = tempRepo();
    setCommitDecision(root, DIR_A, 'commit', AT);
    const again = seedFeatureDelivery(root, DIR_A, { sessionId: 'ses_1', recordedAt: AT });
    expect(again.commit_decision!.answer).toBe('commit');
  });

  it('stamps the session that opened the change when the writer has none (issue #581)', () => {
    const root = tempRepo();
    seedFeatureRecord(root, DIR_A, {
      adapter: 'a',
      sessionId: 'ses_owner',
      now: () => new Date(AT),
    });
    expect(setCommitDecision(root, DIR_A, 'commit', AT).session_id).toBe('ses_owner');
  });

  it('stamps "unknown" when neither the writer nor feature.json knows a session', () => {
    const root = tempRepo();
    expect(setCommitDecision(root, DIR_A, 'commit', AT).session_id).toBe('unknown');
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
    seedOnBranch(root, DIR_A, 'feat/shared');
    seedOnBranch(root, DIR_B, 'feat/shared');
    // B is newer but done; A is older but active → A wins.
    updateFeatureRecord(root, DIR_B, { status: 'done' }, () => new Date(AT));
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(DIR_A);
  });

  it('falls back to the newest when every match is done', () => {
    const root = tempRepo();
    seedOnBranch(root, DIR_A, 'feat/shared');
    seedOnBranch(root, DIR_B, 'feat/shared');
    updateFeatureRecord(root, DIR_A, { status: 'done' }, () => new Date(AT));
    updateFeatureRecord(root, DIR_B, { status: 'done' }, () => new Date(AT));
    expect(resolveDeliveryFeatureByBranch(root, 'feat/shared')).toBe(DIR_B);
  });
});

describe('featureDeliveryBranch (issue #581)', () => {
  it('reads the branch from feature.json', () => {
    const root = tempRepo();
    seedOnBranch(root, DIR_A, 'feat/x');
    expect(featureDeliveryBranch(root, DIR_A)).toBe('feat/x');
  });

  it('falls back to the branch a pre-#581 delivery.json carried (INV-8)', () => {
    const root = tempRepo();
    const dir = join(root, '.paqad/ledger/feature-evidence', DIR_A);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'delivery.json'),
      JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.delivery',
        branch: 'feat/legacy',
        base_branch: 'main',
        commits: [],
        head_sha: null,
        merge_commit: null,
        captured_at: AT,
      }),
    );
    expect(featureDeliveryBranch(root, DIR_A)).toBe('feat/legacy');
    expect(resolveDeliveryFeatureByBranch(root, 'feat/legacy')).toBe(DIR_A);
  });

  it('is null when neither file names a branch', () => {
    expect(featureDeliveryBranch(tempRepo(), DIR_A)).toBeNull();
  });
});

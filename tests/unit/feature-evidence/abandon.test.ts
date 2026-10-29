import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ABANDON_SESSION_ID,
  closeAbandonedBundles,
  type GitRunner,
} from '@/feature-evidence/abandon.js';
import { isBundleClosed, listInFlightFeatures } from '@/feature-evidence/adoption.js';
import { collectFeatureDecisions } from '@/feature-evidence/decisions-index.js';
import {
  readFeatureDelivery,
  recordShip,
  resolveDeliveryFeatureByBranch,
  writeFeatureDelivery,
} from '@/feature-evidence/delivery.js';
import {
  isFeatureFinished,
  readFeatureRecord,
  updateFeatureRecord,
} from '@/feature-evidence/feature-record.js';
import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import { validateFeatureRecord } from '@/feature-evidence/schema.js';
import {
  appendFeatureStageRow,
  readFeatureStageUnit,
  resumeFeatureByRef,
} from '@/feature-evidence/stage-ledger.js';
import { buildTimeline } from '@/hud/snapshot.js';

import {
  checkout,
  cleanupScopeFixtures,
  commit,
  git,
  initGit,
  openChangeHere,
  plainRoot,
  repoRoot,
} from '../hud/scope-fixtures.js';
import { ticketRef } from '../../shared/ticket-ref.js';

afterEach(cleanupScopeFixtures);

const OPENED = new Date('2026-10-01T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const after = (ms: number) => () => new Date(OPENED.getTime() + ms);

function oldChangeOn(root: string, branch: string, session = `ses-${branch}`): string {
  checkout(root, branch, true);
  const dir = openChangeHere(root, session, `ORD-1 ${branch}`, 'full', OPENED);
  checkout(root, 'main');
  return dir;
}

function goneChange(root: string, branch = 'feat/gone'): string {
  const dir = oldChangeOn(root, branch);
  git(root, 'branch', '-D', branch);
  return dir;
}

function countingGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    git: (projectRoot, args) => {
      calls.push(args);
      try {
        return git(projectRoot, ...args);
      } catch {
        return undefined;
      }
    },
  };
}

describe('closeAbandonedBundles', () => {
  it('AC-23: leaves a change quiet for 23h59m and closes one quiet for 24h01m whose branch is gone', () => {
    const root = repoRoot();
    const dir = goneChange(root);

    expect(closeAbandonedBundles(root, { now: after(24 * HOUR - 60_000) })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);

    const closed = closeAbandonedBundles(root, { now: after(24 * HOUR + 60_000) });

    expect(closed).toEqual([{ dir, branch: 'feat/gone', reason: 'branch gone' }]);
    expect(isBundleClosed(root, dir)).toBe(true);
    expect(readFeatureRecord(root, dir)?.status).toBe('abandoned');
    const close = readFeatureStageUnit(root, dir).at(-1)!;
    expect(close).toMatchObject({
      kind: 'close',
      event_status: null,
      note: 'abandoned: branch gone, no row for 24h',
      agent: 'orchestrator',
      session_id: ABANDON_SESSION_ID,
    });
  });

  it('is a no-op on a second run', () => {
    const root = repoRoot();
    const dir = goneChange(root);
    closeAbandonedBundles(root, { now: after(25 * HOUR) });
    const rows = readFeatureStageUnit(root, dir).length;
    expect(closeAbandonedBundles(root, { now: after(26 * HOUR) })).toEqual([]);
    expect(readFeatureStageUnit(root, dir)).toHaveLength(rows);
  });

  it('never touches the change on the branch checked out now', () => {
    const root = repoRoot();
    const dir = oldChangeOn(root, 'feat/here');
    recordShip(
      root,
      dir,
      { pr: { number: 1, url: null, draft: false, state: 'merged' } },
      OPENED.toISOString(),
    );
    checkout(root, 'feat/here');
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR) })).toEqual([]);
  });

  it('never touches a change with no recorded branch', () => {
    const root = plainRoot();
    const dir = openChangeHere(root, 'ses-nobranch', 'ORD-2 no branch', 'full', OPENED);
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR) })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);
  });

  it('keeps a change whose branch still exists on a remote only', () => {
    const root = repoRoot();
    oldChangeOn(root, 'feat/remote');
    git(root, 'update-ref', 'refs/remotes/origin/feat/remote', 'main');
    git(root, 'branch', '-D', 'feat/remote');
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR) })).toEqual([]);
  });

  it('closes a branch merged into main that carries its own commits', () => {
    const root = repoRoot();
    const dir = oldChangeOn(root, 'feat/ancestor');
    writeFeatureDelivery(root, dir, {
      ...readFeatureDelivery(root, dir),
      commit_split: {
        state: 'known',
        reason: null,
        base_commit: 'b',
        own: { count: 1, tickets: [], merges: 0, untagged: 1 },
        inherited: { count: 0, tickets: [], merges: 0, untagged: 0 },
        own_shas: ['x'],
        inherited_shas: [],
      },
    });
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR) })[0]?.reason).toBe('branch merged');
  });

  it('AC-24: never treats a branch freshly cut from main with no own commits as merged', () => {
    const root = repoRoot();
    const dir = oldChangeOn(root, 'feat/fresh');
    expect(closeAbandonedBundles(root, { now: after(25 * HOUR) })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);
  });

  it('keeps a branch with its own unmerged commits', () => {
    const root = repoRoot();
    const dir = oldChangeOn(root, 'feat/ahead');
    checkout(root, 'feat/ahead');
    commit(root, 'ahead.txt', 'feat: ahead');
    checkout(root, 'main');
    writeFeatureDelivery(root, dir, {
      ...readFeatureDelivery(root, dir),
      commit_split: {
        state: 'known',
        reason: null,
        base_commit: 'b',
        own: { count: 1, tickets: [], merges: 0, untagged: 1 },
        inherited: { count: 0, tickets: [], merges: 0, untagged: 0 },
        own_shas: ['ahead'],
        inherited_shas: [],
      },
    });
    expect(closeAbandonedBundles(root, { now: after(25 * HOUR) })).toEqual([]);
  });

  it('AC-27: reads branch existence for 40 old changes with one git call', () => {
    const root = plainRoot();
    for (let index = 0; index < 40; index += 1) {
      const dir = openChangeHere(root, `ses-old-${index}`, `ORD-${index} old`, 'full', OPENED);
      updateFeatureRecord(root, dir, { branch: `feat/old-${index}` });
    }
    initGit(root);
    const { git: counting, calls } = countingGit();
    const closed = closeAbandonedBundles(root, { now: after(48 * HOUR), git: counting });
    expect(closed).toHaveLength(40);
    expect(calls).toEqual([['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']]);
  });

  it('makes no git call when no change is quiet long enough, and stops when git fails', () => {
    const root = repoRoot();
    const dir = goneChange(root);
    const { git: counting, calls } = countingGit();
    closeAbandonedBundles(root, { now: after(HOUR), git: counting });
    expect(calls).toEqual([]);
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR), git: () => undefined })).toEqual(
      [],
    );
    expect(isBundleClosed(root, dir)).toBe(false);
  });

  it('skips a change already closed, done or abandoned', () => {
    const root = repoRoot();
    const dir = goneChange(root);
    const featurePath = join(root, featureFilePath(dir, 'feature'));
    const record = JSON.parse(readFileSync(featurePath, 'utf8')) as Record<string, unknown>;
    writeFileSync(featurePath, JSON.stringify({ ...record, status: 'done' }));
    expect(closeAbandonedBundles(root, { now: after(48 * HOUR) })).toEqual([]);
  });
});

describe('a change whose pull request merged', () => {
  function shippedOn(root: string, branch: string, number: number | null): string {
    const dir = oldChangeOn(root, branch);
    git(root, 'update-ref', `refs/remotes/origin/${branch}`, branch);
    recordShip(
      root,
      dir,
      { pr: { number, url: null, draft: false, state: 'open' } },
      OPENED.toISOString(),
    );
    return dir;
  }

  it('AC-10: closes as done at once when main carries the squash commit for its number', () => {
    const root = repoRoot();
    const dir = shippedOn(root, 'feat/squashed', 766);
    commit(root, 'squash.txt', `feat: parallel review and docs (${ticketRef(766)})`);

    expect(closeAbandonedBundles(root, { now: after(HOUR) })).toEqual([
      { dir, branch: 'feat/squashed', reason: 'pull request merged' },
    ]);
    const closes = readFeatureStageUnit(root, dir).filter((row) => row.kind === 'close');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      session_id: ABANDON_SESSION_ID,
      note: `closed: pull request ${ticketRef(766)} merged`,
    });
    expect(readFeatureRecord(root, dir)?.status).toBe('done');
    expect(closeAbandonedBundles(root, { now: after(2 * HOUR) })).toEqual([]);
  });

  it.each([
    ['a longer number', `feat: other (${ticketRef(7660)})`],
    ['a bare number', `feat: mentions ${ticketRef(766)}`],
    ['a shorter number', `feat: other (${ticketRef(76)})`],
  ])('AC-10: stays open when main only has %s', (_label, subject) => {
    const root = repoRoot();
    const dir = shippedOn(root, 'feat/open', 766);
    commit(root, 'other.txt', subject);

    expect(closeAbandonedBundles(root, { now: after(HOUR) })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);
  });

  it('AC-10: stays open with no pull request number or no matching commit', () => {
    const root = repoRoot();
    const unnumbered = shippedOn(root, 'feat/unnumbered', null);
    const unmatched = shippedOn(root, 'feat/unmatched', 812);
    commit(root, 'squash.txt', `feat: something (${ticketRef(766)})`);

    expect(closeAbandonedBundles(root, { now: after(HOUR) })).toEqual([]);
    expect(isBundleClosed(root, unnumbered)).toBe(false);
    expect(isBundleClosed(root, unmatched)).toBe(false);
  });

  it('closes as done at once when the delivery record says merged', () => {
    const root = repoRoot();
    const dir = oldChangeOn(root, 'feat/merged-now');
    recordShip(
      root,
      dir,
      { pr: { number: 3, url: null, draft: false, state: 'merged' } },
      OPENED.toISOString(),
    );

    expect(closeAbandonedBundles(root, { now: after(HOUR) })).toEqual([
      { dir, branch: 'feat/merged-now', reason: 'pull request merged' },
    ]);
    expect(readFeatureStageUnit(root, dir).at(-1)?.note).toBe(
      `closed: pull request ${ticketRef(3)} merged`,
    );
  });

  it('AC-11: stays open while a stage is running in it, and closes once the session is quiet', () => {
    const root = repoRoot();
    const dir = shippedOn(root, 'feat/busy', 766);
    commit(root, 'squash.txt', `feat: busy (${ticketRef(766)})`);
    appendFeatureStageRow(
      root,
      'ses-busy',
      dir,
      { kind: 'stage_start', stage: 'development', event_status: 'started' },
      after(HOUR - 5 * 60_000),
    );

    expect(closeAbandonedBundles(root, { now: after(HOUR) })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);

    expect(closeAbandonedBundles(root, { now: after(HOUR + 26 * 60_000) })).toHaveLength(1);
    expect(readFeatureRecord(root, dir)?.status).toBe('done');
  });

  it('AC-14: finds the merge on origin/main as already fetched, with no fetch', () => {
    const root = repoRoot();
    const dir = shippedOn(root, 'feat/remote-merge', 766);
    checkout(root, 'tmp-remote', true);
    commit(root, 'squash.txt', `feat: remote only (${ticketRef(766)})`);
    git(root, 'update-ref', 'refs/remotes/origin/main', 'tmp-remote');
    checkout(root, 'main');
    git(root, 'branch', '-D', 'tmp-remote');
    const { git: counting, calls } = countingGit();

    expect(closeAbandonedBundles(root, { now: after(HOUR), git: counting })).toHaveLength(1);
    expect(readFeatureRecord(root, dir)?.status).toBe('done');
    expect(calls.some((args) => args.includes('fetch'))).toBe(false);
  });

  it('AC-14: keeps the 24 hour rule when git fails', () => {
    const root = repoRoot();
    const dir = shippedOn(root, 'feat/no-git', 766);
    commit(root, 'squash.txt', `feat: no git (${ticketRef(766)})`);

    expect(closeAbandonedBundles(root, { now: after(HOUR), git: () => undefined })).toEqual([]);
    expect(isBundleClosed(root, dir)).toBe(false);
  });
});

describe('abandoned counts as closed everywhere (AC-26)', () => {
  it('every reader treats it as finished and resume reopens it', () => {
    const root = repoRoot();
    const dir = goneChange(root, 'feat/left');
    closeAbandonedBundles(root, { now: after(48 * HOUR) });

    expect(isFeatureFinished('abandoned')).toBe(true);
    expect(isFeatureFinished('done')).toBe(true);
    expect(isFeatureFinished('active')).toBe(false);
    expect(isFeatureFinished(null)).toBe(false);
    expect(listInFlightFeatures(root)).not.toContain(dir);
    expect(validateFeatureRecord(readFeatureRecord(root, dir))).toEqual([]);

    const live = oldChangeOn(root, 'feat/left-again', 'ses-live');
    writeFeatureDelivery(root, dir, {
      ...readFeatureDelivery(root, dir),
      branch: 'feat/left-again',
    });
    expect(resolveDeliveryFeatureByBranch(root, 'feat/left-again')).toBe(live);

    mkdirSync(join(root, '.paqad/decisions/resolved'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/decisions/resolved/D-01LATE.json'),
      JSON.stringify({
        id: 'D-01LATE',
        category: 'ux-pattern',
        resolved_at: '2030-01-01T00:00:00.000Z',
      }),
    );
    expect(collectFeatureDecisions(root, dir)).toEqual([]);
    expect(featureChangeKey(dir)).not.toBe('');

    expect(resumeFeatureByRef(root, 'ses-back', featureChangeKey(dir))).toBe(dir);
    expect(isBundleClosed(root, dir)).toBe(false);
    expect(readFeatureRecord(root, dir)?.status).toBe('active');
    expect(buildTimeline(root, dir).slice(-2)).toMatchObject([
      { kind: 'close', note: 'abandoned: branch gone, no row for 24h' },
      { kind: 'open', note: 'reopened via resume' },
    ]);
  });
});

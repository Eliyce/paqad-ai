import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  adoptableInFlightOnBranch,
  anotherSessionRunningStage,
  featureBranch,
  isBundleClosed,
  isBundleMaterialized,
  listAdoptableFeatures,
  listInFlightFeatures,
  reconcileSessionControl,
  sessionClosedAnyFeature,
  sessionReattachableFeature,
} from '@/feature-evidence/adoption.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  readSessionControl,
  setActiveFeature,
  writeSessionControl,
} from '@/feature-evidence/session-control.js';
import { readFeatureRecord, updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  openFeatureChange,
  readFeatureStageUnit,
  recordChangeConstants,
  resolveActiveFeature,
} from '@/feature-evidence/stage-ledger.js';

import { STAGE_AGENT_SESSION_RELEASE } from '@/stage-evidence/stage-agent-holds.js';

import { appendLegacyStageRow } from '../../shared/legacy-stage-row.js';

const roots: string[] = [];

function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-adoption-'));
  roots.push(r);
  return r;
}

function tempRepo(branch = 'main'): string {
  const r = tempRoot();
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: r, stdio: ['ignore', 'ignore', 'ignore'] });
  g('init', '-q', '-b', branch);
  g('config', 'user.email', 't@t.dev');
  g('config', 'user.name', 'Test');
  writeFileSync(join(r, 'a.txt'), 'a');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  return r;
}

function checkoutBranch(root: string, branch: string): void {
  execFileSync('git', ['checkout', '-q', '-b', branch], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-19T00:00:00.000Z');

function materialize(
  root: string,
  dirName: string,
  sessionId = 'ses_a',
  branch: string | null = 'main',
): string {
  recordChangeConstants(root, dirName, { adapter: 'claude-code', branch }, clock);
  appendFeatureStageRow(root, sessionId, dirName, { kind: 'open' }, clock);
  return dirName;
}

function close(root: string, dirName: string, sessionId = 'ses_a'): void {
  appendFeatureStageRow(
    root,
    sessionId,
    dirName,
    { kind: 'close', event_status: 'completed' },
    clock,
  );
}

const BUNDLE_A = '404-first-change-01JABCDEFGHJKMNPQRSTVWXYZ0';
const BUNDLE_B = '404-second-change-01JABCDEFGHJKMNPQRSTVWXYZ1';

describe('isBundleMaterialized', () => {
  it('is false for a bundle name that has no stage rows on disk', () => {
    const root = tempRoot();
    expect(isBundleMaterialized(root, BUNDLE_A)).toBe(false);
  });

  it('is true once the bundle carries a stage row', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    expect(isBundleMaterialized(root, BUNDLE_A)).toBe(true);
  });
});

describe('listInFlightFeatures', () => {
  it('is empty when no bundle exists', () => {
    expect(listInFlightFeatures(tempRoot())).toEqual([]);
  });

  it('lists a materialized bundle that carries no close row', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    expect(listInFlightFeatures(root)).toEqual([BUNDLE_A]);
  });

  it('excludes a bundle the finalizer closed (INV-2)', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    expect(listInFlightFeatures(root)).toEqual([]);
  });

  it('lists every open bundle when several are in flight', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    materialize(root, BUNDLE_B);
    expect(listInFlightFeatures(root)).toEqual([BUNDLE_A, BUNDLE_B]);
  });
});

describe('reconcileSessionControl', () => {
  it('returns null and writes nothing when there is no bundle at all', () => {
    const root = tempRepo();
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
    expect(readSessionControl(root, 'ses_new').active).toBeNull();
  });

  it('keeps a healthy active pointer untouched', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_A);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_A);
  });

  it('keeps a not-yet-materialized pointer when there is nothing to adopt (AC-2)', () => {
    const root = tempRepo();
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    expect(isBundleMaterialized(root, BUNDLE_A)).toBe(false);

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_A);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_A);
  });

  it('repoints a dangling pointer at the in-flight bundle instead of leaving it (AC-2)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_B);
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_B);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_B);
  });

  it('leaves the paused stack alone — a paused entry is never adopted or pruned', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_B);
    writeSessionControl(
      root,
      { ...readSessionControl(root, 'ses_a', clock), active: null, paused: [BUNDLE_A] },
      clock,
    );

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_B);
    expect(readSessionControl(root, 'ses_a').paused).toEqual([BUNDLE_A]);
  });

  it('adopts the single in-flight bundle for a session that has never seen it (FR-3)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_old');

    expect(reconcileSessionControl(root, 'ses_new', clock)).toBe(BUNDLE_A);
    expect(readSessionControl(root, 'ses_new').active).toBe(BUNDLE_A);
  });

  it('adopts nothing when two bundles are in flight (FR-4, INV-3)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_old');
    materialize(root, BUNDLE_B, 'ses_old');

    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
    expect(readSessionControl(root, 'ses_new').active).toBeNull();
  });

  it('adopts nothing when the only bundle was closed (AC-5)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_old');
    close(root, BUNDLE_A, 'ses_old');

    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
  });

  it('never adopts a bundle this session deliberately paused', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    writeSessionControl(
      root,
      { ...readSessionControl(root, 'ses_a', clock), active: null, paused: [BUNDLE_A] },
      clock,
    );

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBeNull();
    expect(readSessionControl(root, 'ses_a').paused).toEqual([BUNDLE_A]);
  });

  it('never mints a bundle (INV-1)', () => {
    const root = tempRepo();
    reconcileSessionControl(root, 'ses_new', clock);
    expect(listFeatureDirs(root)).toEqual([]);
  });
});

describe('closeActiveFeature writes a durable close row', () => {
  it('stamps a close row so another session cannot adopt the finished change', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', ulidSeed: 1 });
    closeActiveFeature(root, 'ses_a');

    expect(listInFlightFeatures(root)).toEqual([]);
    expect(currentFeature(root, 'ses_other')).toBeNull();
    expect(readFeatureStageUnit(root, dir).some((row) => row.kind === 'close')).toBe(true);
  });

  it('leaves the adapter on feature.json and off the close row', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'codex-cli', ulidSeed: 1 });
    closeActiveFeature(root, 'ses_a');

    const close = readFeatureStageUnit(root, dir).find((row) => row.kind === 'close');
    expect(close).toBeDefined();
    expect(close).not.toHaveProperty('adapter');
    expect(readFeatureRecord(root, dir)?.adapter).toBe('codex-cli');
  });

  it('writes no close row for a bundle that was never materialized', () => {
    const root = tempRepo();
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    closeActiveFeature(root, 'ses_a');

    expect(readFeatureStageUnit(root, BUNDLE_A)).toEqual([]);
    expect(currentFeature(root, 'ses_a')).toBeNull();
  });

  it('does not write a second close row when the finalizer already wrote one', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', ulidSeed: 1 });
    appendFeatureStageRow(
      root,
      'ses_a',
      dir,
      { kind: 'close', note: 'closed; verdict=complete' },
      clock,
    );
    closeActiveFeature(root, 'ses_a');

    const closes = readFeatureStageUnit(root, dir).filter((row) => row.kind === 'close');
    expect(closes).toHaveLength(1);
    expect(closes[0]!.note).toBe('closed; verdict=complete');
  });
});

describe('session-id rotation mid-change', () => {
  it('keeps one bundle when the id rotates between stage calls (AC-1, AC-4)', () => {
    const root = tempRepo();

    const first = openFeatureChange(root, 'ses_before', {
      adapter: 'claude-code',
      title: 'Adopt in flight bundle',
      issue: '404',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      now: clock,
    });
    appendFeatureStageRow(
      root,
      'ses_before',
      first,
      { kind: 'stage_start', stage: 'planning', event_status: 'started' },
      clock,
    );
    appendFeatureStageRow(
      root,
      'ses_before',
      first,
      { kind: 'stage_end', stage: 'planning', event_status: 'completed' },
      clock,
    );

    const second = resolveActiveFeature(root, 'ses_after', { now: clock });

    expect(second).toBe(first);
    expect(listFeatureDirs(root)).toEqual([first]);
  });

  it('leaves the pre-rotation stage valid for the change (AC-3)', () => {
    const root = tempRepo();
    const dir = materialize(root, BUNDLE_A, 'ses_before');
    appendFeatureStageRow(
      root,
      'ses_before',
      dir,
      { kind: 'stage_end', stage: 'planning', event_status: 'completed' },
      clock,
    );

    expect(resolveActiveFeature(root, 'ses_after', { now: clock })).toBe(dir);
    expect(listFeatureDirs(root)).toEqual([dir]);
  });

  it('carries the change over on the read path too (FR-6)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_before');

    expect(currentFeature(root, 'ses_after')).toBe(BUNDLE_A);
  });

  it('still mints new work when a title is given (FR-7, AC-6)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_before');

    const fresh = resolveActiveFeature(root, 'ses_after', {
      title: 'Genuinely new work',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
      now: clock,
    });
    expect(fresh).not.toBe(BUNDLE_A);
  });
});

describe('branch scoping', () => {
  it('records the branch on feature.json at open, never on the row', () => {
    const root = tempRepo();
    checkoutBranch(root, 'fix/404-rotation');
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', ulidSeed: 1 });

    const open = readFeatureStageUnit(root, dir).find((row) => row.kind === 'open');
    expect(open).not.toHaveProperty('branch');
    expect(readFeatureRecord(root, dir)?.branch).toBe('fix/404-rotation');
    expect(featureBranch(root, dir)).toBe('fix/404-rotation');
  });

  it('still reads the branch a pre-envelope bundle stamped on its open row (INV-8)', () => {
    const root = tempRepo();
    appendLegacyStageRow(root, BUNDLE_A, 'ses_a', { kind: 'open', branch: 'fix/legacy' });
    expect(featureBranch(root, BUNDLE_A)).toBe('fix/legacy');
  });

  it('falls back to delivery.json for a bundle opened before the stamp existed', () => {
    const root = tempRepo();
    appendLegacyStageRow(root, BUNDLE_A, 'ses_a', { kind: 'open' });
    expect(featureBranch(root, BUNDLE_A)).toBeNull();

    const deliveryAbs = join(root, featureFilePath(BUNDLE_A, 'delivery'));
    mkdirSync(dirname(deliveryAbs), { recursive: true });
    writeFileSync(
      deliveryAbs,
      JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.delivery',
        branch: 'fix/from-delivery',
        commits: [],
      }),
    );
    expect(featureBranch(root, BUNDLE_A)).toBe('fix/from-delivery');
  });

  it('does not adopt an in-flight bundle that belongs to another branch', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_old', 'fix/some-other-change');
    checkoutBranch(root, 'fix/404-rotation');

    expect(listInFlightFeatures(root)).toEqual([BUNDLE_A]);
    expect(listAdoptableFeatures(root, 'fix/404-rotation')).toEqual([]);
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
  });

  it('adopts across a rotation while other branches sit in flight (the real-repo case)', () => {
    const root = tempRepo();
    for (const [i, other] of ['a', 'b', 'c', 'd'].entries()) {
      materialize(
        root,
        `404-stale-${other}-01JABCDEFGHJKMNPQRSTVWXY${i}Z`,
        'ses_old',
        `fix/${other}`,
      );
    }
    checkoutBranch(root, 'fix/404-rotation');
    const mine = materialize(root, BUNDLE_A, 'ses_before', 'fix/404-rotation');

    expect(listInFlightFeatures(root)).toHaveLength(5);
    expect(reconcileSessionControl(root, 'ses_after', clock)).toBe(mine);
  });

  it('is ambiguous, and adopts nothing, when two bundles share the branch', () => {
    const root = tempRepo();
    checkoutBranch(root, 'fix/404-rotation');
    materialize(root, BUNDLE_A, 'ses_old', 'fix/404-rotation');
    materialize(root, BUNDLE_B, 'ses_old', 'fix/404-rotation');

    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
  });

  it('never adopts a bundle whose branch is unknown while on a branch', () => {
    const root = tempRepo();
    appendFeatureStageRow(root, 'ses_a', BUNDLE_A, { kind: 'open' }, clock);

    expect(featureBranch(root, BUNDLE_A)).toBeNull();
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
  });

  it('degrades to the unscoped in-flight set when no branch can be read (non-git)', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_old', null);

    expect(listAdoptableFeatures(root, null)).toEqual([BUNDLE_A]);
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBe(BUNDLE_A);
  });
});

describe('sessionReattachableFeature', () => {
  const later = () => new Date('2026-07-20T00:00:00.000Z');

  it('AC-4: finds the session’s own closed change on the branch', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a', 'fix/x');
    close(root, BUNDLE_A, 'ses_a');
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBe(BUNDLE_A);
  });

  it('AC-24: never picks a change on another branch', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a', 'fix/other');
    close(root, BUNDLE_A, 'ses_a');
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBeNull();
  });

  it('AC-24: never picks another session’s change', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_b', 'fix/x');
    close(root, BUNDLE_A, 'ses_b');
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBeNull();
  });

  it('AC-24: finds nothing when no change exists or no branch can be read', () => {
    const root = tempRoot();
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBeNull();
    materialize(root, BUNDLE_A, 'ses_a', 'fix/x');
    close(root, BUNDLE_A, 'ses_a');
    expect(sessionReattachableFeature(root, 'ses_a', null)).toBeNull();
  });

  it('skips a change that is still in flight or was abandoned', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a', 'fix/x');
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBeNull();
    close(root, BUNDLE_A, 'ses_a');
    updateFeatureRecord(root, BUNDLE_A, { status: 'abandoned' }, clock);
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBeNull();
  });

  it('picks the most recently closed of the session’s changes', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a', 'fix/x');
    close(root, BUNDLE_A, 'ses_a');
    materialize(root, BUNDLE_B, 'ses_a', 'fix/x');
    appendFeatureStageRow(
      root,
      'ses_a',
      BUNDLE_B,
      { kind: 'close', event_status: 'completed' },
      later,
    );
    expect(sessionReattachableFeature(root, 'ses_a', 'fix/x')).toBe(BUNDLE_B);
  });
});

describe('sessionClosedAnyFeature', () => {
  it('is false when the session has recorded nothing', () => {
    expect(sessionClosedAnyFeature(tempRoot(), 'ses_a')).toBe(false);
  });

  it('is false while the session’s change is still in flight', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a');
    expect(sessionClosedAnyFeature(root, 'ses_a')).toBe(false);
  });

  it('is true once the session closed a change', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a');
    close(root, BUNDLE_A, 'ses_a');
    expect(sessionClosedAnyFeature(root, 'ses_a')).toBe(true);
  });

  it('attributes the close to the session that wrote it, not to every session', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a');
    close(root, BUNDLE_A, 'ses_a');
    expect(sessionClosedAnyFeature(root, 'ses_b')).toBe(false);
  });

  it('finds the close in any bundle, not only the newest one', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_a');
    close(root, BUNDLE_A, 'ses_a');
    materialize(root, BUNDLE_B, 'ses_a');
    expect(sessionClosedAnyFeature(root, 'ses_a')).toBe(true);
  });
});

describe('isBundleClosed', () => {
  it('is false for a bundle with no rows', () => {
    expect(isBundleClosed(tempRoot(), BUNDLE_A)).toBe(false);
  });

  it('is false for a materialized, unclosed bundle', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    expect(isBundleClosed(root, BUNDLE_A)).toBe(false);
  });

  it('is true once the last lifecycle row is a close', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    expect(isBundleClosed(root, BUNDLE_A)).toBe(true);
  });

  it('is false again after a reopen (a later open row), while the ever-closed filter still excludes it', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    appendFeatureStageRow(
      root,
      'ses_a',
      BUNDLE_A,
      { kind: 'open', note: 'reopened via resume' },
      clock,
    );
    expect(isBundleClosed(root, BUNDLE_A)).toBe(false);
    expect(listInFlightFeatures(root)).toEqual([]);
  });
});

describe('reconcileSessionControl — a closed change is never served as active', () => {
  it('AC-1: releases a stale pointer at a closed bundle and opens a fresh change on stage start', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    writeSessionControl(root, { ...readSessionControl(root, 'ses_a'), active: BUNDLE_A });

    const opened = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', now: clock });

    expect(opened).not.toBe(BUNDLE_A);
    expect(readFeatureStageUnit(root, BUNDLE_A)).toHaveLength(2);
    expect(readSessionControl(root, 'ses_a').active).toBe(opened);
  });

  it('AC-2: the live resolve path releases the stale closed pointer instead of returning it', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    writeSessionControl(root, { ...readSessionControl(root, 'ses_a'), active: BUNDLE_A });

    const resolved = currentFeature(root, 'ses_a');

    expect(resolved).not.toBe(BUNDLE_A);
    expect(resolved).toBeNull();
    expect(readSessionControl(root, 'ses_a').active).toBeNull();
    expect(readFeatureStageUnit(root, BUNDLE_A)).toHaveLength(2);
  });

  it('adopts a genuinely in-flight bundle on the branch after releasing the closed pointer', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    materialize(root, BUNDLE_B);
    writeSessionControl(root, { ...readSessionControl(root, 'ses_a'), active: BUNDLE_A });

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_B);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_B);
  });

  it('AC-5: survives the lost-update shape (read active, close, write the stale copy back)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    const stale = readSessionControl(root, 'ses_a');
    closeActiveFeature(root, 'ses_a', clock);
    expect(readSessionControl(root, 'ses_a').active).toBeNull();
    writeSessionControl(root, stale);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_A);

    const opened = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', now: clock });
    expect(opened).not.toBe(BUNDLE_A);
    expect(readFeatureStageUnit(root, BUNDLE_A)).toHaveLength(2);
    expect(readSessionControl(root, 'ses_a').active).toBe(opened);
  });

  it('records the writer (written_by) when it releases a stale closed pointer', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A);
    close(root, BUNDLE_A);
    writeSessionControl(root, { ...readSessionControl(root, 'ses_a'), active: BUNDLE_A });
    reconcileSessionControl(root, 'ses_a', clock);
    expect(readSessionControl(root, 'ses_a').written_by).toBe('reconcile');
  });
});

describe('a change another session is running', () => {
  const T0 = Date.parse('2026-07-19T00:00:00.000Z');
  const at = (minutes: number) => () => new Date(T0 + minutes * 60_000);

  function startStages(root: string, dirName: string, sessionId: string, stages: string[]): void {
    for (const stage of stages) {
      appendFeatureStageRow(
        root,
        sessionId,
        dirName,
        { kind: 'stage_start', stage, event_status: 'started' },
        at(0),
      );
    }
  }

  function endStages(root: string, dirName: string, sessionId: string, stages: string[]): void {
    for (const stage of stages) {
      appendFeatureStageRow(
        root,
        sessionId,
        dirName,
        { kind: 'stage_end', stage, event_status: 'completed' },
        at(5),
      );
    }
  }

  const RUNNING = ['development', 'checks', 'documentation_sync'];

  it('AC-4: is not adopted while the other session runs a stage, and is once the stages end', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', RUNNING);
    setActiveFeature(root, 'ses_other', BUNDLE_A, { now: at(0) });
    const otherControl = readSessionControl(root, 'ses_other');

    expect(anotherSessionRunningStage(root, 'ses_new', BUNDLE_A, at(5))).toBe('documentation_sync');
    expect(reconcileSessionControl(root, 'ses_new', at(5))).toBeNull();
    expect(readSessionControl(root, 'ses_new').active).toBeNull();
    expect(readSessionControl(root, 'ses_new').written_by).toBeUndefined();
    expect(readSessionControl(root, 'ses_other')).toEqual(otherControl);

    endStages(root, BUNDLE_A, 'ses_other', RUNNING);
    expect(anotherSessionRunningStage(root, 'ses_new', BUNDLE_A, at(6))).toBeNull();
    expect(reconcileSessionControl(root, 'ses_new', at(6))).toBe(BUNDLE_A);
  });

  it('AC-5: counts a dead session as quiet once its newest row is 30 minutes old', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);

    expect(reconcileSessionControl(root, 'ses_new', at(29))).toBeNull();
    expect(reconcileSessionControl(root, 'ses_new', at(31))).toBe(BUNDLE_A);
  });

  it('is held by a live stage agent of another session, however old its rows', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    appendFeatureStageRow(
      root,
      'ses_other',
      BUNDLE_A,
      {
        kind: 'stage-agent',
        event_status: 'started',
        stage: 'review',
        agent: 'paqad-review',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      at(0),
    );

    expect(anotherSessionRunningStage(root, 'ses_new', BUNDLE_A, at(240))).toBe('review');
    expect(reconcileSessionControl(root, 'ses_new', at(240))).toBeNull();
  });

  it('treats a stage ended by another writer as ended', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);
    endStages(root, BUNDLE_A, 'paqad-backstop', ['development']);

    expect(reconcileSessionControl(root, 'ses_new', at(6))).toBe(BUNDLE_A);
  });

  it('releases an earlier adopted pointer to null without pausing it', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);
    setActiveFeature(root, 'ses_new', BUNDLE_A, { now: at(0) });

    expect(reconcileSessionControl(root, 'ses_new', at(5))).toBeNull();
    const control = readSessionControl(root, 'ses_new');
    expect(control.active).toBeNull();
    expect(control.paused).toEqual([]);
    expect(control.written_by).toBe('reconcile');
  });

  it('keeps the change for a session that wrote a row in it', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);
    appendFeatureStageRow(
      root,
      'ses_mine',
      BUNDLE_A,
      { kind: 'stage_start', stage: 'review', event_status: 'started' },
      at(1),
    );

    expect(anotherSessionRunningStage(root, 'ses_mine', BUNDLE_A, at(5))).toBeNull();
    expect(reconcileSessionControl(root, 'ses_mine', at(5))).toBe(BUNDLE_A);
  });

  it('still adopts a quiet bundle after a /clear between stages', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_before');
    startStages(root, BUNDLE_A, 'ses_before', ['planning']);
    endStages(root, BUNDLE_A, 'ses_before', ['planning']);

    expect(resolveActiveFeature(root, 'ses_after_clear', { now: at(6) })).toBe(BUNDLE_A);
    expect(listFeatureDirs(root)).toEqual([BUNDLE_A]);
  });

  it('does not count a stage agent release row as this session working in the change', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);
    appendFeatureStageRow(
      root,
      'ses_new',
      BUNDLE_A,
      { kind: 'record-repair', reason: STAGE_AGENT_SESSION_RELEASE, releases: [] },
      at(1),
    );

    expect(reconcileSessionControl(root, 'ses_new', at(5))).toBeNull();
  });

  it('leaves the running bundle out of the adoptable set on the branch', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_other');
    startStages(root, BUNDLE_A, 'ses_other', ['development']);

    expect(adoptableInFlightOnBranch(root, 'ses_new', at(5))).toEqual([]);
    expect(adoptableInFlightOnBranch(root, 'ses_other', at(5))).toEqual([BUNDLE_A]);
  });
});

describe('an active change on another branch', () => {
  function git(root: string, ...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  function onFeatA(): string {
    const root = tempRepo();
    checkoutBranch(root, 'feat/a');
    materialize(root, BUNDLE_A, 'ses_a', 'feat/a');
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    return root;
  }

  it('AC-8: clears the pointer when the checked-out branch differs, without pausing it', () => {
    const root = onFeatA();
    checkoutBranch(root, 'fix/b');

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBeNull();
    const control = readSessionControl(root, 'ses_a');
    expect(control.active).toBeNull();
    expect(control.written_by).toBe('reconcile');
    expect(control.paused).not.toContain(BUNDLE_A);
  });

  it('AC-8: a bare stage start opens a new change on the new branch and writes nothing to the old one', () => {
    const root = onFeatA();
    const before = readFeatureStageUnit(root, BUNDLE_A).length;
    checkoutBranch(root, 'fix/b');

    const fresh = resolveActiveFeature(root, 'ses_a', {
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ7',
      now: clock,
    });
    expect(fresh).not.toBe(BUNDLE_A);
    expect(readFeatureStageUnit(root, BUNDLE_A)).toHaveLength(before);
    expect(readSessionControl(root, 'ses_a').paused).not.toContain(BUNDLE_A);
  });

  it('AC-9: picks the change up again when its branch is checked out again', () => {
    const root = onFeatA();
    checkoutBranch(root, 'fix/b');
    const fresh = openFeatureChange(root, 'ses_a', {
      adapter: 'claude-code',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ8',
      now: clock,
    });
    expect(fresh).not.toBe(BUNDLE_A);

    git(root, 'checkout', '-q', 'feat/a');
    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_A);
    expect(readSessionControl(root, 'ses_a').active).toBe(BUNDLE_A);
  });

  it('AC-8: keeps the pointer on a detached HEAD', () => {
    const root = onFeatA();
    git(root, 'checkout', '-q', '--detach');

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_A);
  });

  it('AC-8: keeps the pointer for a change with no recorded branch', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_a', null);
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    checkoutBranch(root, 'fix/b');

    expect(reconcileSessionControl(root, 'ses_a', clock)).toBe(BUNDLE_A);
  });
});

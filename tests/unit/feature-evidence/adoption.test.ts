import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  featureBranch,
  isBundleMaterialized,
  listAdoptableFeatures,
  listInFlightFeatures,
  reconcileSessionControl,
} from '@/feature-evidence/adoption.js';
import { readFeatureDelivery, writeFeatureDelivery } from '@/feature-evidence/delivery.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import {
  readSessionControl,
  setActiveFeature,
  writeSessionControl,
} from '@/feature-evidence/session-control.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  openFeatureChange,
  readFeatureStageUnit,
  resolveActiveFeature,
} from '@/feature-evidence/stage-ledger.js';

const roots: string[] = [];

/** A bare temp dir — NOT a git repo, so the branch scope cannot apply (the degrade path). */
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-adoption-'));
  roots.push(r);
  return r;
}

/** A temp git repo on `main`, so adoption resolves a real branch (the normal path). */
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

/** Move `root` onto a new branch, the way a developer would mid-change. */
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

/**
 * Materialize a bundle by writing one `open` row into it, as the recorder would —
 * carrying the branch stamp the recorder writes (issue #404).
 */
function materialize(
  root: string,
  dirName: string,
  sessionId = 'ses_a',
  branch: string | null = 'main',
): string {
  appendFeatureStageRow(
    root,
    sessionId,
    dirName,
    { kind: 'open', adapter: 'claude-code', branch },
    clock,
  );
  return dirName;
}

/** Close a bundle the way the finalizer does (issue #321). */
function close(root: string, dirName: string, sessionId = 'ses_a'): void {
  appendFeatureStageRow(
    root,
    sessionId,
    dirName,
    { kind: 'close', adapter: 'claude-code', event_status: 'completed' },
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

  // Decision D-01KXY2BDSN226DDCH9DZA1TAK6 narrowed FR-2 to repoint-only: a dangling
  // pointer is never simply cleared, because `resolveActiveFeature` sets a freshly minted
  // feature active BEFORE its first row lands — clearing there would drop the live change.
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

// Decision D-01KXY2BDSN226DDCH9DZA1TAK6: releasing the pointer used to be the only
// record that a change was finished, which no other session can see — so adoption would
// resurrect it. `closeActiveFeature` now stamps the bundle itself.
describe('closeActiveFeature writes a durable close row', () => {
  it('stamps a close row so another session cannot adopt the finished change', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', ulidSeed: 1 });
    closeActiveFeature(root, 'ses_a');

    expect(listInFlightFeatures(root)).toEqual([]);
    expect(currentFeature(root, 'ses_other')).toBeNull();
    expect(readFeatureStageUnit(root, dir).some((row) => row.kind === 'close')).toBe(true);
  });

  it('inherits the adapter from the bundle rather than inventing one', () => {
    const root = tempRepo();
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'codex-cli', ulidSeed: 1 });
    closeActiveFeature(root, 'ses_a');

    const close = readFeatureStageUnit(root, dir).find((row) => row.kind === 'close');
    expect(close?.adapter).toBe('codex-cli');
  });

  it('writes no close row for a bundle that was never materialized', () => {
    const root = tempRepo();
    setActiveFeature(root, 'ses_a', BUNDLE_A, { now: clock });
    closeActiveFeature(root, 'ses_a');

    // Nothing to close: an empty bundle is not in flight, so no row is stamped and the
    // bundle is not materialized just to close it.
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
      { kind: 'close', adapter: 'claude-code', note: 'closed; verdict=complete' },
      clock,
    );
    closeActiveFeature(root, 'ses_a');

    const closes = readFeatureStageUnit(root, dir).filter((row) => row.kind === 'close');
    expect(closes).toHaveLength(1);
    expect(closes[0]!.note).toBe('closed; verdict=complete');
  });
});

describe('session-id rotation mid-change (issue #404)', () => {
  it('keeps one bundle when the id rotates between stage calls (AC-1, AC-4)', () => {
    const root = tempRepo();

    // Session 1 opens the change and records a stage. `openFeatureChange` is what the
    // live recorder calls, and it is what stamps the branch on the `open` row.
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
      { kind: 'stage_start', stage: 'planning', adapter: 'claude-code', event_status: 'started' },
      clock,
    );

    // The host session id rotates. The next stage call resolves under the NEW id.
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
      { kind: 'stage_end', stage: 'planning', adapter: 'claude-code', event_status: 'completed' },
      clock,
    );

    // A rotated session resolves the same bundle, so the planning rows still count —
    // no manual re-recording into a second bundle.
    expect(resolveActiveFeature(root, 'ses_after', { now: clock })).toBe(dir);
    expect(listFeatureDirs(root)).toEqual([dir]);
  });

  it('carries the change over on the read path too (FR-6)', () => {
    const root = tempRepo();
    materialize(root, BUNDLE_A, 'ses_before');

    // `currentFeature` is what the pre-mutation gate and the finalizer read. Before the
    // fix this was null after a rotation, so finalize wrote its backstop into a NEW bundle.
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

// Decision D-01KXY55ZM70Y3JNDM8E0XC7WSX. Without the branch scope, "in flight" meant
// "materialized and never closed", which a real repo accumulates without bound — an
// abandoned change and a change shipped without a passing verdict both stay in flight
// forever. The repo this was found in held 13, so the "exactly one" guard never held and
// adoption was dead code.
describe('branch scoping (issue #404)', () => {
  it('stamps the branch on the open row so a bundle is attributable from row 1', () => {
    const root = tempRepo();
    checkoutBranch(root, 'fix/404-rotation');
    const dir = openFeatureChange(root, 'ses_a', { adapter: 'claude-code', ulidSeed: 1 });

    const open = readFeatureStageUnit(root, dir).find((row) => row.kind === 'open');
    expect(open?.branch).toBe('fix/404-rotation');
    expect(featureBranch(root, dir)).toBe('fix/404-rotation');
  });

  it('falls back to delivery.json for a bundle opened before the stamp existed', () => {
    const root = tempRepo();
    // An `open` row with no branch — exactly what a pre-#404 bundle carries on disk.
    appendFeatureStageRow(root, 'ses_a', BUNDLE_A, { kind: 'open', adapter: 'claude-code' }, clock);
    expect(featureBranch(root, BUNDLE_A)).toBeNull();

    writeFeatureDelivery(root, BUNDLE_A, {
      ...readFeatureDelivery(root, BUNDLE_A),
      branch: 'fix/from-delivery',
    });
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
    // Four unrelated changes left in flight on other branches, as a real repo accumulates.
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

    // The rotated session still lands on ITS change, not on nothing.
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
    appendFeatureStageRow(root, 'ses_a', BUNDLE_A, { kind: 'open', adapter: 'claude-code' }, clock);

    expect(featureBranch(root, BUNDLE_A)).toBeNull();
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBeNull();
  });

  it('degrades to the unscoped in-flight set when no branch can be read (non-git)', () => {
    const root = tempRoot();
    materialize(root, BUNDLE_A, 'ses_old', null);

    // Nothing to scope by, so the pre-branch rule stands rather than blocking adoption.
    expect(listAdoptableFeatures(root, null)).toEqual([BUNDLE_A]);
    expect(reconcileSessionControl(root, 'ses_new', clock)).toBe(BUNDLE_A);
  });
});

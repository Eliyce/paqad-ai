import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { SiteMapProgressUnit } from '@/core/types/site-map-progress.js';
import { hashSourceFiles } from '@/document/staleness.js';
import { VERSION } from '@/index.js';
import {
  completeUnit,
  createEmptyProgress,
  createUnit,
  describeCompletedUnits,
  failUnit,
  readProgress,
  reconcileDoneUnits,
  recoverInFlight,
  saveProgress,
  startUnit,
  summarizeProgress,
} from '@/site-map/progress-store.js';
import type { SiteMapProgressUnitKind } from '@/core/types/site-map-progress.js';

const T0 = new Date('2026-08-31T10:00:00.000Z');
const T1 = new Date('2026-08-31T10:05:00.000Z');
const T2 = new Date('2026-08-31T10:10:00.000Z');

describe('site-map progress store (S5a)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-progress-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function progressPath(): string {
    return join(root, PATHS.SITE_MAP_PROGRESS);
  }

  function writeRaw(contents: string): void {
    const target = progressPath();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }

  describe('createEmptyProgress', () => {
    it('seeds the shape from the inventory and stamps VERSION + timestamps', () => {
      const groups = ['billing', 'checkout'];
      const progress = createEmptyProgress({ screens: 12, groups }, T0);

      expect(progress).toEqual({
        schema_version: '1',
        generated_by: 'paqad-ai',
        framework_version: VERSION,
        created_at: T0.toISOString(),
        updated_at: T0.toISOString(),
        inventory: { screens: 12, groups: ['billing', 'checkout'] },
        units: {},
      });

      // The groups array is copied, not aliased.
      groups.push('mutated');
      expect(progress.inventory.groups).toEqual(['billing', 'checkout']);
    });
  });

  describe('state transitions (AC-1)', () => {
    it('moves a unit not_started -> writing -> done, then failUnit -> failed', () => {
      const unit = createUnit({
        id: 'group:billing',
        kind: 'group',
        label: 'Billing',
        artifact: 'docs/site-map/app-map.yaml',
        source_files: ['src/billing.ts'],
      });
      expect(unit.state).toBe('not_started');
      expect(unit.started_at).toBeNull();
      expect(unit.source_hash).toBeNull();

      startUnit(unit, T0);
      expect(unit.state).toBe('writing');
      expect(unit.started_at).toBe(T0.toISOString());

      completeUnit(unit, 'sha1:abcdef0', T1);
      expect(unit.state).toBe('done');
      expect(unit.completed_at).toBe(T1.toISOString());
      expect(unit.source_hash).toBe('sha1:abcdef0');
      expect(unit.error).toBeNull();

      failUnit(unit, 'boom', T2);
      expect(unit.state).toBe('failed');
      expect(unit.completed_at).toBe(T2.toISOString());
      expect(unit.error).toBe('boom');
    });
  });

  describe('readProgress is tolerant (AC-2, INV-1)', () => {
    it('reads a missing file as null', async () => {
      expect(await readProgress(root)).toBeNull();
    });

    it('reads a corrupt (non-JSON) file as null', async () => {
      writeRaw('{ this is not json');
      expect(await readProgress(root)).toBeNull();
    });

    it('reads a schema-invalid file as null', async () => {
      writeRaw(JSON.stringify({ schema_version: '1', generated_by: 'paqad-ai' }));
      expect(await readProgress(root)).toBeNull();
    });
  });

  describe('saveProgress is atomic (FR-4)', () => {
    it('round-trips through disk, stamps updated_at, and leaves no temp file', async () => {
      const progress = createEmptyProgress({ screens: 1, groups: ['a'] }, T0);
      await saveProgress(root, progress, T1);

      const read = await readProgress(root);
      expect(read).not.toBeNull();
      expect(read?.updated_at).toBe(T1.toISOString());
      expect(read?.created_at).toBe(T0.toISOString());
      expect(read).toEqual(progress);

      const leftovers = readdirSync(join(root, PATHS.SITE_MAP_ROOT_DIR)).filter((name) =>
        name.endsWith('.tmp'),
      );
      expect(leftovers).toEqual([]);
    });

    it('does not interleave two concurrent writes (AC-6)', async () => {
      const a = createEmptyProgress({ screens: 1, groups: ['a'] }, T0);
      a.units['u-a'] = createUnit({
        id: 'u-a',
        kind: 'group',
        label: 'A',
        artifact: null,
        source_files: [],
      });
      const b = createEmptyProgress({ screens: 2, groups: ['b'] }, T0);
      b.units['u-b'] = createUnit({
        id: 'u-b',
        kind: 'journey',
        label: 'B',
        artifact: null,
        source_files: [],
      });

      await Promise.all([saveProgress(root, a, T1), saveProgress(root, b, T2)]);

      const read = await readProgress(root);
      // The file on disk is one complete, schema-valid document — never a mix of both.
      expect(read).not.toBeNull();
      expect([JSON.stringify(a), JSON.stringify(b)]).toContain(JSON.stringify(read));

      const leftovers = readdirSync(join(root, PATHS.SITE_MAP_ROOT_DIR)).filter((name) =>
        name.endsWith('.tmp'),
      );
      expect(leftovers).toEqual([]);
    });
  });

  describe('recoverInFlight — crash recovery on load (AC-3, INV-2)', () => {
    it('resets every writing unit and deletes its artifact, leaving others untouched', async () => {
      const artifactRel = join('.paqad', 'site-map', 'artifacts', 'j1.yaml');
      const artifactAbs = join(root, artifactRel);
      mkdirSync(dirname(artifactAbs), { recursive: true });
      writeFileSync(artifactAbs, 'half-written', 'utf8');

      const progress = createEmptyProgress({ screens: 3, groups: [] }, T0);
      progress.units['writing-with-artifact'] = writingUnit('writing-with-artifact', artifactRel);
      progress.units['writing-no-artifact'] = writingUnit('writing-no-artifact', null);
      const done = createUnit({
        id: 'done',
        kind: 'group',
        label: 'Done',
        artifact: 'docs/site-map/app-map.yaml',
        source_files: [],
      });
      completeUnit(done, 'sha1:kept', T0);
      progress.units['done'] = done;

      const reset = await recoverInFlight(root, progress);

      expect(reset.sort()).toEqual(['writing-no-artifact', 'writing-with-artifact']);
      // The half-written artifact is gone.
      expect(existsSync(artifactAbs)).toBe(false);

      for (const id of ['writing-with-artifact', 'writing-no-artifact']) {
        expect(progress.units[id].state).toBe('not_started');
        expect(progress.units[id].started_at).toBeNull();
        expect(progress.units[id].error).toBeNull();
      }
      // The done unit is left exactly as it was.
      expect(progress.units['done'].state).toBe('done');
      expect(progress.units['done'].source_hash).toBe('sha1:kept');
    });
  });

  describe('reconcileDoneUnits — the skip rule (AC-4, AC-5)', () => {
    it('skips a done unit whose source_hash still matches, and ignores non-done units', async () => {
      writeFileSync(join(root, 'src.ts'), 'export const x = 1;\n', 'utf8');
      const hash = await hashSourceFiles(root, ['src.ts']);

      const progress = createEmptyProgress({ screens: 1, groups: [] }, T0);
      const unit = createUnit({
        id: 'group:a',
        kind: 'group',
        label: 'A',
        artifact: null,
        source_files: ['src.ts'],
      });
      completeUnit(unit, hash, T0);
      progress.units['group:a'] = unit;
      // A not_started unit must be ignored entirely.
      progress.units['group:b'] = createUnit({
        id: 'group:b',
        kind: 'group',
        label: 'B',
        artifact: null,
        source_files: ['src.ts'],
      });

      const result = await reconcileDoneUnits(root, progress);

      expect(result.skipped).toEqual(['group:a']);
      expect(result.reset).toEqual([]);
      expect(progress.units['group:a'].state).toBe('done');
    });

    it('resets a done unit whose source changed since it was recorded', async () => {
      writeFileSync(join(root, 'src.ts'), 'export const x = 1;\n', 'utf8');
      const staleHash = await hashSourceFiles(root, ['src.ts']);

      const progress = createEmptyProgress({ screens: 1, groups: [] }, T0);
      const unit = createUnit({
        id: 'group:a',
        kind: 'group',
        label: 'A',
        artifact: null,
        source_files: ['src.ts'],
      });
      completeUnit(unit, staleHash, T0);
      progress.units['group:a'] = unit;

      // The code the unit describes moves.
      writeFileSync(join(root, 'src.ts'), 'export const x = 2;\n', 'utf8');

      const result = await reconcileDoneUnits(root, progress);

      expect(result.reset).toEqual(['group:a']);
      expect(result.skipped).toEqual([]);
      expect(progress.units['group:a'].state).toBe('not_started');
      expect(progress.units['group:a'].source_hash).toBeNull();
      expect(progress.units['group:a'].completed_at).toBeNull();
    });
  });

  describe('summarizeProgress (S5b, AC-4)', () => {
    function seed(): ReturnType<typeof createEmptyProgress> {
      return createEmptyProgress({ screens: 0, groups: [] }, T0);
    }

    function put(
      progress: ReturnType<typeof createEmptyProgress>,
      id: string,
      apply?: (unit: SiteMapProgressUnit) => void,
    ): void {
      const unit = createUnit({
        id,
        kind: 'group',
        label: `label:${id}`,
        artifact: null,
        source_files: [],
      });
      apply?.(unit);
      progress.units[id] = unit;
    }

    it('counts every state, sets remaining = not_started, and picks the first not_started as next', () => {
      const progress = seed();
      put(progress, 'group:done', (u) => completeUnit(u, 'h', T1));
      put(progress, 'group:writing', (u) => startUnit(u, T1));
      put(progress, 'group:failed', (u) => failUnit(u, 'boom', T1));
      put(progress, 'group:todo-1'); // not_started
      put(progress, 'group:todo-2'); // not_started

      const summary = summarizeProgress(progress);

      expect(summary).toEqual({
        total: 5,
        done: 1,
        writing: 1,
        failed: 1,
        remaining: 2,
        next: { id: 'group:todo-1', label: 'label:group:todo-1' },
      });
      // total = done + writing + failed + remaining (FR-5).
      expect(summary.done + summary.writing + summary.failed + summary.remaining).toBe(
        summary.total,
      );
    });

    it('next is the FIRST not_started unit in declaration order, not a later one', () => {
      const progress = seed();
      put(progress, 'group:first'); // not_started
      put(progress, 'group:second'); // not_started

      expect(summarizeProgress(progress).next).toEqual({
        id: 'group:first',
        label: 'label:group:first',
      });
    });

    it('an all-done store has no next unit and zero remaining', () => {
      const progress = seed();
      put(progress, 'group:a', (u) => completeUnit(u, 'h', T1));
      put(progress, 'group:b', (u) => completeUnit(u, 'h', T1));

      expect(summarizeProgress(progress)).toEqual({
        total: 2,
        done: 2,
        writing: 0,
        failed: 0,
        remaining: 0,
        next: null,
      });
    });

    it('an empty store summarises to all zeroes and no next', () => {
      expect(summarizeProgress(seed())).toEqual({
        total: 0,
        done: 0,
        writing: 0,
        failed: 0,
        remaining: 0,
        next: null,
      });
    });
  });

  describe('describeCompletedUnits (S6, FR-3)', () => {
    function put(
      progress: ReturnType<typeof createEmptyProgress>,
      id: string,
      kind: SiteMapProgressUnitKind,
      label: string,
      apply?: (unit: SiteMapProgressUnit) => void,
    ): void {
      const unit = createUnit({ id, kind, label, artifact: null, source_files: [] });
      apply?.(unit);
      progress.units[id] = unit;
    }

    it('words each done unit as "<Kind> <ordinal> of <total-of-kind>: <label>", per kind', () => {
      const progress = createEmptyProgress({ screens: 0, groups: [] }, T0);
      // Two groups (one done), three journeys (two done), one done stage. Ordinals count within a
      // kind in declaration order, and the total is the count of that kind, not just the done ones.
      put(progress, 'group:billing', 'group', 'Billing', (u) => completeUnit(u, 'h', T1));
      put(progress, 'group:admin', 'group', 'Admin'); // not_started — no line
      put(progress, 'journey:checkout', 'journey', 'Checkout, guest', (u) =>
        completeUnit(u, 'h', T1),
      );
      put(progress, 'journey:signup', 'journey', 'Sign up'); // not_started — no line
      put(progress, 'journey:reset', 'journey', 'Reset password', (u) => completeUnit(u, 'h', T1));
      put(progress, 'stage:links', 'stage', 'Links', (u) => completeUnit(u, 'h', T1));

      expect(describeCompletedUnits(progress)).toEqual([
        'Group 1 of 2: Billing',
        'Journey 1 of 3: Checkout, guest',
        'Journey 3 of 3: Reset password',
        'Stage 1 of 1: Links',
      ]);
    });

    it('returns no lines when nothing is done (writing/failed/not_started are not reported)', () => {
      const progress = createEmptyProgress({ screens: 0, groups: [] }, T0);
      put(progress, 'group:a', 'group', 'A', (u) => startUnit(u, T1));
      put(progress, 'group:b', 'group', 'B', (u) => failUnit(u, 'boom', T1));
      put(progress, 'group:c', 'group', 'C'); // not_started

      expect(describeCompletedUnits(progress)).toEqual([]);
    });

    it('returns an empty list for a store with no units', () => {
      expect(describeCompletedUnits(createEmptyProgress({ screens: 0, groups: [] }, T0))).toEqual(
        [],
      );
    });
  });
});

function writingUnit(id: string, artifact: string | null): SiteMapProgressUnit {
  const unit = createUnit({ id, kind: 'journey', label: id, artifact, source_files: [] });
  startUnit(unit, T0);
  return unit;
}

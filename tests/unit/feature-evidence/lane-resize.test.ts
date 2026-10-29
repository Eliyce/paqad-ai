import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  readChangeConstants,
  readFeatureRecord,
  updateFeatureRecord,
  writeFeatureRecord,
} from '@/feature-evidence/feature-record.js';
import {
  editedFiles,
  isRiskyImpact,
  planFiles,
  laneMayRise,
  planLaneResize,
  raiseLaneIfGrown,
} from '@/feature-evidence/lane-resize.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  recordChangeConstants,
} from '@/feature-evidence/stage-ledger.js';
import type { PlanStep } from '@/feature-evidence/types.js';
import { writePendingImpact, writePendingLane } from '@/stage-evidence/pending-lane.js';
import { openStageEvidence } from '@/stage-evidence/recorder.js';

const S = 'ses-lane-resize';
const AT = '2026-10-29T12:00:00.000Z';
const now = () => new Date(AT);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-lane-resize-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function fullChange(root: string, lane: 'graduated' | 'full' | null = 'full'): string {
  const dir = openFeatureChange(root, S, {
    adapter: 'claude-code',
    title: 'ORD-750 small change',
    issue: 'ORD-750',
    lane,
  });
  writePendingImpact(root, S, { database_impact: 'none', api_impact: 'additive-endpoint' });
  return dir;
}

function steps(count: number): PlanStep[] {
  const files = Array.from({ length: count }, (_, i) => `src/file-${i}.ts`);
  return [
    { id: 'S1', description: 'first half', files: files.slice(0, 4) },
    { id: 'S2', description: 'second half, one repeated', files: [files[0]!, ...files.slice(4)] },
  ];
}

function resize(
  root: string,
  dir: string,
  overrides: Partial<{ files: number; changed: string[] }> = {},
) {
  return planLaneResize({
    projectRoot: root,
    sessionId: S,
    dirName: dir,
    steps: steps(overrides.files ?? 8),
    changedFiles: overrides.changed ?? [],
    now,
  });
}

function writeSensitiveModuleMap(root: string): void {
  mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  writeFileSync(
    join(root, PATHS.MODULE_MAP),
    'version: 2\nmodules:\n  - slug: secure-core\n    name: Secure Core\n    sensitivity: high\n    sources:\n      - src/secure\n',
    'utf8',
  );
}

describe('the plan facts', () => {
  it('counts a path listed in two steps once', () => {
    expect(planFiles(steps(8))).toHaveLength(8);
    expect(planFiles(undefined)).toEqual([]);
    expect(planFiles([{ id: 'S1', description: 'no files' }])).toEqual([]);
  });

  it('treats a missing impact, a schema change, a migration and a breaking API change as risky', () => {
    expect(isRiskyImpact(null)).toBe(true);
    expect(isRiskyImpact({ database_impact: 'schema-change', api_impact: 'none' })).toBe(true);
    expect(isRiskyImpact({ database_impact: 'data-migration', api_impact: 'none' })).toBe(true);
    expect(isRiskyImpact({ database_impact: 'none', api_impact: 'breaking-change' })).toBe(true);
    expect(
      isRiskyImpact({ database_impact: 'additive-only', api_impact: 'modified-endpoint' }),
    ).toBe(false);
  });

  it('ignores the .paqad folder when it looks for code edits', () => {
    expect(editedFiles(['.paqad/x.json', '.paqad', 'src/a.ts', 'src/a.ts'])).toEqual(['src/a.ts']);
  });
});

describe('planLaneResize', () => {
  it('lowers a classifier-set full lane to graduated for a small, safe plan', () => {
    const root = project();
    const dir = fullChange(root);
    expect(readFeatureRecord(root, dir)?.lane_source).toBe('classifier');

    const moved = resize(root, dir);

    expect(moved).toEqual({
      from: 'full',
      to: 'graduated',
      reason: 'the plan touches 8 files, none sensitive, no schema or breaking API change',
      files: 8,
      at: AT,
    });
    const record = readFeatureRecord(root, dir)!;
    expect(record).toMatchObject({ lane: 'graduated', lane_source: 'plan', lane_resized: moved });
    expect(readChangeConstants(root, dir).lane).toBe('graduated');
  });

  it('names a single file in the singular', () => {
    const root = project();
    const dir = fullChange(root);
    const moved = planLaneResize({
      projectRoot: root,
      sessionId: S,
      dirName: dir,
      steps: [{ id: 'S1', description: 'one', files: ['src/one.ts'] }],
      changedFiles: ['.paqad/ledger/x.json'],
    });
    expect(moved?.reason).toBe(
      'the plan touches 1 file, none sensitive, no schema or breaking API change',
    );
  });

  it('keeps full for 9 files', () => {
    const root = project();
    const dir = fullChange(root);
    expect(resize(root, dir, { files: 9 })).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
  });

  it('keeps full for a planned high-sensitivity path', () => {
    const root = project();
    writeSensitiveModuleMap(root);
    const dir = fullChange(root);
    const moved = planLaneResize({
      projectRoot: root,
      sessionId: S,
      dirName: dir,
      steps: [{ id: 'S1', description: 'keys', files: ['src/secure/keys.ts'] }],
      changedFiles: [],
      now,
    });
    expect(moved).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
  });

  it.each([
    [{ database_impact: 'schema-change', api_impact: 'none' }],
    [{ database_impact: 'data-migration', api_impact: 'none' }],
    [{ database_impact: 'none', api_impact: 'breaking-change' }],
  ] as const)('keeps full for a risky impact %j', (impact) => {
    const root = project();
    const dir = fullChange(root);
    writePendingImpact(root, S, impact);
    expect(resize(root, dir)).toBeNull();
  });

  it('keeps full with no saved impact', () => {
    const root = project();
    const dir = openFeatureChange(root, S, {
      adapter: 'claude-code',
      title: 'no impact',
      issue: null,
      lane: 'full',
    });
    expect(resize(root, dir)).toBeNull();
  });

  it('keeps full once a source file changed in the working tree', () => {
    const root = project();
    const dir = fullChange(root);
    expect(resize(root, dir, { changed: ['src/app.ts'] })).toBeNull();
  });

  it.each(['specification', 'development', 'checks', 'documentation_sync'])(
    'keeps full once %s has started',
    (stage) => {
      const root = project();
      const dir = fullChange(root);
      appendFeatureStageRow(root, S, dir, { kind: 'stage_start', stage, event_status: 'started' });
      expect(resize(root, dir)).toBeNull();
      expect(readFeatureRecord(root, dir)?.lane).toBe('full');
    },
  );

  it('keeps full when the lane was set by hand, never recorded a source, or is not full', () => {
    const manual = project();
    const manualDir = fullChange(manual, 'graduated');
    recordChangeConstants(manual, manualDir, { lane: 'full', laneSource: 'manual' });
    expect(readFeatureRecord(manual, manualDir)?.lane_source).toBe('manual');
    expect(resize(manual, manualDir)).toBeNull();

    const legacy = project();
    const legacyDir = fullChange(legacy);
    const withoutSource = { ...readFeatureRecord(legacy, legacyDir)! };
    delete withoutSource.lane_source;
    writeFeatureRecord(legacy, legacyDir, withoutSource);
    expect(resize(legacy, legacyDir)).toBeNull();

    const graduated = project();
    expect(resize(graduated, fullChange(graduated, 'graduated'))).toBeNull();
    const unresolved = project();
    expect(resize(unresolved, fullChange(unresolved, null))).toBeNull();
  });

  it('lowers at most once: a second compile with a revised plan changes nothing', () => {
    const root = project();
    const dir = fullChange(root);
    const first = resize(root, dir);
    expect(first).not.toBeNull();
    expect(resize(root, dir, { files: 2 })).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane_resized).toEqual(first);
  });
});

describe('the lane after a plan resize', () => {
  function resized(): { root: string; dir: string } {
    const root = project();
    const dir = fullChange(root);
    resize(root, dir);
    return { root, dir };
  }

  it('is not raised back by a classifier-sourced patch', () => {
    const { root, dir } = resized();
    recordChangeConstants(root, dir, { lane: 'full' });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'graduated', lane_source: 'plan' });
  });

  it('stays graduated when a stage start re-reads a pending classifier lane of full', () => {
    const { root, dir } = resized();
    writePendingLane(root, S, 'full');
    openStageEvidence(root, { sessionId: S, adapter: 'claude-code' });
    expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
  });

  it('rises to full on a manual lane set, and the plan never lowers it again', () => {
    const { root, dir } = resized();
    recordChangeConstants(root, dir, { lane: 'full', laneSource: 'manual' });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'manual' });
    expect(resize(root, dir)).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
  });
});

describe('updateFeatureRecord lane rules', () => {
  it('never lowers a lane through an ordinary patch', () => {
    const root = project();
    const dir = fullChange(root);
    updateFeatureRecord(root, dir, { lane: 'fast' });
    recordChangeConstants(root, dir, { lane: 'graduated' });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'classifier' });
  });

  it('records the classifier as the source when a patch first sets the lane', () => {
    const root = project();
    const dir = fullChange(root, null);
    expect(readFeatureRecord(root, dir)?.lane_source).toBeUndefined();
    recordChangeConstants(root, dir, { lane: 'graduated' });
    expect(readFeatureRecord(root, dir)).toMatchObject({
      lane: 'graduated',
      lane_source: 'classifier',
    });
  });

  it('pins the source to manual for a manual request at the current lane', () => {
    const root = project();
    const dir = fullChange(root);
    recordChangeConstants(root, dir, { lane: 'full', laneSource: 'manual' });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'manual' });
  });

  it('keeps the source on a manual request below the current lane', () => {
    const root = project();
    const dir = fullChange(root);
    recordChangeConstants(root, dir, { lane: 'graduated', laneSource: 'manual' });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'classifier' });
  });

  it('refuses a resize after the spec has started even when called directly', () => {
    const root = project();
    const dir = fullChange(root);
    appendFeatureStageRow(root, S, dir, {
      kind: 'stage_start',
      stage: 'specification',
      event_status: 'started',
    });
    updateFeatureRecord(root, dir, { resizeLaneFromPlan: { reason: 'r', files: 1, at: AT } });
    expect(readFeatureRecord(root, dir)?.lane_resized).toBeUndefined();
    expect(readFeatureRecord(root, dir)?.lane).toBe('full');
  });
});

describe('raiseLaneIfGrown', () => {
  const LATER = '2026-10-29T13:00:00.000Z';
  const later = () => new Date(LATER);

  function resized(): { root: string; dir: string } {
    const root = project();
    const dir = fullChange(root);
    resize(root, dir);
    return { root, dir };
  }

  function grow(root: string, dir: string, changedFiles: string[], plannedFiles: string[] = []) {
    return raiseLaneIfGrown({
      projectRoot: root,
      dirName: dir,
      plannedFiles,
      changedFiles,
      now: later,
    });
  }

  const eleven = Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`);

  it('raises a plan-lowered lane to full once the change touches more than 8 files', () => {
    const { root, dir } = resized();
    const moved = grow(root, dir, [...eleven, '.paqad/x.json']);
    expect(moved).toEqual({
      from: 'graduated',
      to: 'full',
      reason: 'the change now touches 11 files',
      files: 11,
      at: LATER,
    });
    expect(readFeatureRecord(root, dir)).toMatchObject({
      lane: 'full',
      lane_source: 'plan',
      lane_raised: moved,
    });
    expect(laneMayRise(root, dir)).toBe(false);
  });

  it('raises at most once and the plan never lowers it again', () => {
    const { root, dir } = resized();
    const first = grow(root, dir, eleven);
    expect(grow(root, dir, [...eleven, 'src/more.ts'])).toBeNull();
    expect(resize(root, dir, { files: 1 })).toBeNull();
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_raised: first });
  });

  it('raises for an edited or a planned high-sensitivity path, naming it', () => {
    const edited = resized();
    writeSensitiveModuleMap(edited.root);
    expect(grow(edited.root, edited.dir, ['src/secure/keys.ts'])?.reason).toBe(
      'the change touches a sensitive path: src/secure/keys.ts',
    );

    const planned = resized();
    writeSensitiveModuleMap(planned.root);
    expect(grow(planned.root, planned.dir, ['src/a.ts'], ['src/secure/vault.ts'])).toMatchObject({
      reason: 'the change touches a sensitive path: src/secure/vault.ts',
      files: 1,
    });
  });

  it('keeps graduated while the change stays small and safe', () => {
    const { root, dir } = resized();
    expect(grow(root, dir, ['src/a.ts', 'src/b.ts'])).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
  });

  it('leaves a lane the plan never lowered alone', () => {
    const root = project();
    const dir = fullChange(root, 'graduated');
    expect(laneMayRise(root, dir)).toBe(false);
    expect(grow(root, dir, eleven)).toBeNull();
    updateFeatureRecord(root, dir, { raiseLaneFromChange: { reason: 'r', files: 11, at: LATER } });
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'graduated' });
    expect(readFeatureRecord(root, dir)?.lane_raised).toBeUndefined();
  });
});

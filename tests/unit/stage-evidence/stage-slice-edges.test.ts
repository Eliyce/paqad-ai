import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  developmentEndCheck,
  runSlicePhase,
  sliceBriefText,
  slicesReport,
  slicesSettings,
} from '@/cli/commands/stage-slice.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { CompiledSlicing } from '@/stage-evidence/slices.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const PLAN: CompiledSlicing = {
  workstreams: [
    {
      id: 'store',
      owned_files: ['src/store/**', 'tests/store/**'],
      acs: ['AC-1'],
      depends_on: [],
      provides_seams: [],
      uses_seams: [],
      risk: 'high',
      size_budget: { files: 10 },
    },
  ],
  waves: [['store']],
  joining: [{ id: 'join-wiring', area: 'wiring', owned_files: ['src/index.ts'] }],
};

function bareRepo(): string {
  const root = makeEmptyRepo('main');
  roots.push(root);
  writeRepoFile(root, 'README.md', 'x\n');
  commitAll(root, 'base');
  return root;
}

function repo(session: string): { root: string; dir: string } {
  const root = bareRepo();
  const dir = openChange(root, session);
  writeFileSync(
    join(root, featureFilePath(dir, 'plan')),
    JSON.stringify({ summary: 's', ...PLAN }),
  );
  writeRepoFile(root, 'src/store/rows.ts', 'export const rows = 1;\n');
  writeRepoFile(root, 'tests/store/rows.test.ts', "it('AC-1 reads rows', () => 1);\n");
  return { root, dir };
}

const failing = { tests: () => ['tests: 1 failed'] };

describe('slice brief', () => {
  it('AC-25 AC-26 briefs a joining entry with no criteria or seams and refuses an unknown id', () => {
    expect(sliceBriefText(PLAN, 'nope')).toBeNull();
    const brief = sliceBriefText(PLAN, 'join-wiring')!;
    expect(brief).toContain('- Criteria: none');
    expect(brief).toContain('- Owned files: `src/index.ts`');
    expect(brief).toContain('- Seams you provide: none');
    expect(brief).toContain('- Seams you use: none');
    expect(brief).toContain('.paqad/tmp/slice-join-wiring-progress.md');
  });
});

describe('stage slice phases on refusal paths', () => {
  it('AC-35 refuses without an active change, a workstream name, a known id or a known action', async () => {
    const lone = bareRepo();
    expect(
      await runSlicePhase('start', 'store', { projectRoot: lone, sessionId: 'x', agentId: null }),
    ).toEqual({ ok: false, message: 'no active change for this session' });
    const { root } = repo('ses-ref');
    const ctx = { projectRoot: root, sessionId: 'ses-ref', agentId: 'ag-1', changedFiles: [] };
    expect(await runSlicePhase('gate', undefined, ctx)).toEqual({
      ok: false,
      message: 'name the workstream to gate',
    });
    expect((await runSlicePhase('gate', 'nope', ctx)).message).toMatch(
      /not a workstream or joining entry/,
    );
    expect((await runSlicePhase('gate', 'store', ctx)).message).toBe(
      'slice "store" has no slice_start row',
    );
    expect((await runSlicePhase('merge', 'store', ctx)).message).toMatch(
      /unknown slice action "merge"/,
    );
  });

  it('AC-22 resume prints what it keeps and dispatches again', async () => {
    const { root } = repo('ses-res');
    const ctx = { projectRoot: root, sessionId: 'ses-res', agentId: 'ag-1' };
    await runSlicePhase('start', 'store', ctx);
    const result = await runSlicePhase('resume', undefined, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.message)).toMatchObject({
      kept: [],
      redispatch: [{ id: 'store', handback: '.paqad/tmp/slice-store-progress.md' }],
    });
  });

  it('AC-2 gates the changed files git reports when none are passed', async () => {
    const { root, dir } = repo('ses-git');
    const ctx = { projectRoot: root, sessionId: 'ses-git', agentId: null };
    await runSlicePhase('start', 'store', ctx);
    expect(await runSlicePhase('gate', 'store', { ...ctx, steps: failing })).toMatchObject({
      ok: false,
    });
    const start = readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_start')!;
    expect(start.agent_id).toBeUndefined();
    expect(readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_gate')).toMatchObject({
      failures: ['tests: 1 failed'],
      slowest_step: expect.any(String),
    });
  });

  it('AC-21 reports a packet it could not raise and still fails the gate', async () => {
    const { root } = repo('ses-pkt');
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'decisions'), 'not a directory');
    const errors: string[] = [];
    const ctx = {
      projectRoot: root,
      sessionId: 'ses-pkt',
      agentId: 'ag-1',
      changedFiles: ['src/store/rows.ts', 'tests/store/rows.test.ts'],
      steps: failing,
      err: (line: string) => errors.push(line),
    };
    await runSlicePhase('start', 'store', ctx);
    await runSlicePhase('gate', 'store', ctx);
    const last = await runSlicePhase('gate', 'store', ctx);
    expect(last.ok).toBe(false);
    expect(last.packet).toBeUndefined();
    expect(errors[0]).toMatch(/^could not raise the slice packet: /);
  });
});

describe('lead checks without a change or a plan', () => {
  it('AC-17 has nothing to say without an active change or compiled plan', () => {
    const lone = bareRepo();
    expect(developmentEndCheck(lone, 'x', null)).toBeNull();
    expect(slicesSettings(lone, 'x')).toBeNull();
    expect(slicesReport(lone, 'x')).toBeNull();
    const { root, dir } = repo('ses-noplan');
    writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify({ summary: 's' }));
    expect(slicesSettings(root, 'ses-noplan')).toBeNull();
    expect(slicesReport(root, 'ses-noplan')).toBeNull();
  });

  it('AC-14 a done slice named by workstream no longer stands in for its agent', async () => {
    const { root } = repo('ses-done');
    const ctx = {
      projectRoot: root,
      sessionId: 'ses-done',
      agentId: 'ag-store',
      changedFiles: ['src/store/rows.ts', 'tests/store/rows.test.ts'],
      steps: { tests: () => [] },
    };
    await runSlicePhase('start', 'store', ctx);
    await runSlicePhase('gate', 'store', ctx);
    expect((await runSlicePhase('done', 'store', ctx)).ok).toBe(true);
    expect(developmentEndCheck(root, 'ses-done', null, 'store')).toBeNull();
  });
});

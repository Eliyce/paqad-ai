import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { developmentEndCheck, runSlicePhase } from '@/cli/commands/stage-slice.js';
import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';
import { writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { deferCompletionForBackgroundStage } from '@/stage-evidence/completion-deferred.js';

import { evaluateDecisionPauseGate } from '../../runtime/hooks/decision-pause-gate.mjs';
import { commitAll, makeEmptyRepo, writeRepoFile } from '../unit/pipeline/changed-files.fixture.js';
import { openChange, writeSpec } from '../unit/traceability/change-map.fixture.js';

const SESSION = 'ses-fan-out-e2e';
const AGENTS: Record<string, string> = {
  store: 'ag-store',
  view: 'ag-view',
  api: 'ag-api',
  'join-wiring': 'ag-join-wiring',
};

const FILES: Record<string, Record<string, string>> = {
  store: {
    'src/store/rows.ts': 'export const rows = 1;\n',
    'tests/store/rows.test.ts':
      "import { rows } from '../../src/store/rows';\nit('AC-1 reads rows', () => rows);\n",
  },
  view: {
    'src/view/page.ts': 'export const page = 1;\n',
    'tests/view/page.test.ts':
      "import { page } from '../../src/view/page';\nit('AC-3 shows the page', () => page);\n",
  },
  api: {
    'src/api/get.ts': "import { rows } from '../store/rows';\nexport const get = rows;\n",
    'tests/api/get.test.ts':
      "import { rows } from '../../src/store/rows';\nit('AC-2 wires rows', () => rows);\n",
  },
  'join-wiring': {
    'src/index.ts': "export { get } from './api/get';\n",
  },
};

const roots: string[] = [];
let stderr = '';

beforeEach(() => {
  vi.stubEnv('PAQAD_MANAGED', '1');
  vi.stubEnv('SE_SESSION', undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function ctx(root: string, id: string) {
  return {
    projectRoot: root,
    sessionId: SESSION,
    agentId: AGENTS[id]!,
    changedFiles: Object.values(FILES).flatMap((files) => Object.keys(files)),
    err: () => undefined,
  };
}

function editFrom(root: string, file: string): Promise<number> {
  const payload = {
    cwd: root,
    tool_name: 'Edit',
    session_id: SESSION,
    tool_input: { file_path: join(root, file) },
  };
  return evaluateDecisionPauseGate(JSON.stringify(payload), {
    loadResolver: () => import('@/stage-evidence/live-writer.js'),
  });
}

async function scriptedSlice(root: string, id: string): Promise<void> {
  expect((await runSlicePhase('start', id, ctx(root, id))).ok).toBe(true);
  for (const [file, text] of Object.entries(FILES[id]!)) writeRepoFile(root, file, text);
  expect((await runSlicePhase('gate', id, ctx(root, id))).ok).toBe(true);
  expect((await runSlicePhase('done', id, ctx(root, id))).ok).toBe(true);
}

describe('fan-out build of a fixture project', () => {
  it('AC-10 builds three slices and one seam, defers Stop and lets only the lead end development', async () => {
    const root = makeEmptyRepo('main');
    roots.push(root);
    writeRepoFile(root, 'README.md', 'fixture\n');
    commitAll(root, 'base');
    const dir = openChange(root, SESSION);
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
      { id: 'AC-3', proof: 'automated' },
    ]);

    writeFeaturePlan(root, SESSION, {
      summary: 'three slices and one seam',
      reuse: {
        consulted: [{ source: 'grep', query: 'rows', hits: 0 }],
        reusing: [],
        new_constructs: [],
      },
      steps: [
        {
          id: 'S1',
          description: 'slices',
          files: ['src/store/rows.ts', 'src/view/page.ts', 'src/api/get.ts'],
        },
        { id: 'S2', description: 'wiring', files: ['src/index.ts'] },
      ],
      workstreams: [
        {
          id: 'store',
          owned_files: ['src/store/**', 'tests/store/**'],
          acs: ['AC-1'],
          depends_on: [],
          provides_seams: [{ name: 'rows', entry_file: 'src/store/rows.ts', wired_ac: 'AC-2' }],
          uses_seams: [],
          risk: 'high',
          size_budget: { files: 5 },
        },
        {
          id: 'view',
          owned_files: ['src/view/**', 'tests/view/**'],
          acs: ['AC-3'],
          depends_on: [],
          provides_seams: [],
          uses_seams: [],
          risk: 'routine',
          size_budget: { files: 5 },
        },
        {
          id: 'api',
          owned_files: ['src/api/**', 'tests/api/**'],
          acs: ['AC-2'],
          depends_on: ['store'],
          provides_seams: [],
          uses_seams: ['rows'],
          risk: 'high',
          size_budget: { files: 5 },
        },
      ],
    });
    const plan = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'plan')), 'utf8'));
    expect(plan.waves).toEqual([['store', 'view'], ['api']]);
    expect(plan.joining.map((entry: { id: string }) => entry.id)).toContain('join-wiring');

    expect((await runSlicePhase('start', 'store', ctx(root, 'store'))).ok).toBe(true);
    const stop = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
    });
    expect(stop).toMatchObject({ deferred: true, reason: 'slices running' });

    const packet = createPendingDecision(root, {
      category: 'spec.expert_conflict',
      title: 'Which page layout?',
      context: 'the view slice waits on the person',
      options: [
        { option_key: 'grid', label: 'grid' },
        { option_key: 'list', label: 'list' },
      ],
      change: featureChangeKey(dir),
      workstream: 'view',
    }).id;
    expect(await editFrom(root, 'src/store/rows.ts')).toBe(0);
    expect(await editFrom(root, 'src/view/page.ts')).toBe(2);
    expect(stderr).toContain(packet);
    resolvePendingDecision(root, packet, 'grid', 'the person chose');

    for (const [file, text] of Object.entries(FILES.store!)) writeRepoFile(root, file, text);
    expect((await runSlicePhase('gate', 'store', ctx(root, 'store'))).ok).toBe(true);
    expect(developmentEndCheck(root, SESSION, AGENTS.store!)).toMatch(/store/);
    expect((await runSlicePhase('done', 'store', ctx(root, 'store'))).ok).toBe(true);

    await scriptedSlice(root, 'view');
    await scriptedSlice(root, 'api');
    expect(developmentEndCheck(root, SESSION, null)).toMatch(/rows/);
    await scriptedSlice(root, 'join-wiring');

    expect(developmentEndCheck(root, SESSION, AGENTS.api!)).not.toBeNull();
    const refused = readFeatureStageUnit(root, dir).filter(
      (row) => row.kind === 'slice_end_refused',
    );
    expect(refused.length).toBeGreaterThanOrEqual(2);
    expect(developmentEndCheck(root, SESSION, null)).toBeNull();
  });
});

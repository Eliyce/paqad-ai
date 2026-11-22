import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { heavyRunFailures, runSliceGate, wiredFailures } from '@/checks/slice-gate.js';
import {
  developmentEndCheck,
  leadGuideText,
  runSlicePhase,
  slicesReport,
  slicesSettings,
} from '@/cli/commands/stage-slice.js';
import { readContractDecisions } from '@/decisions/authoring.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { DEAD_SLICE_MS, resumeFanOut } from '@/stage-evidence/slices.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const PLAN = {
  workstreams: [
    {
      id: 'store',
      owned_files: ['src/store/**', 'tests/store/**'],
      acs: ['AC-1'],
      depends_on: [],
      provides_seams: [{ name: 'rows', entry_file: 'src/store/rows.ts', wired_ac: 'AC-2' }],
      uses_seams: [],
      risk: 'high',
      size_budget: { files: 10 },
    },
    {
      id: 'api',
      owned_files: ['src/api/**', 'tests/api/**'],
      acs: ['AC-2'],
      depends_on: ['store'],
      provides_seams: [],
      uses_seams: ['rows'],
      risk: 'routine',
      size_budget: { files: 10 },
    },
  ],
  waves: [['store'], ['api']],
  joining: [
    { id: 'join-wiring', area: 'wiring', owned_files: ['src/index.ts'] },
    { id: 'join-lint-cleanup', area: 'lint-cleanup', owned_files: [] },
  ],
};

function repo(session: string): { root: string; dir: string } {
  const root = makeEmptyRepo('main');
  roots.push(root);
  writeRepoFile(root, 'README.md', 'x\n');
  commitAll(root, 'base');
  const dir = openChange(root, session);
  writeFileSync(
    join(root, featureFilePath(dir, 'plan')),
    JSON.stringify({ summary: 's', ...PLAN }),
  );
  writeRepoFile(root, 'src/store/rows.ts', 'export const rows = 1;\n');
  writeRepoFile(
    root,
    'tests/store/rows.test.ts',
    "import { rows } from '../../src/store/rows';\nit('AC-1 reads rows', () => rows);\n",
  );
  writeRepoFile(root, 'src/api/get.ts', 'export const get = 1;\n');
  writeRepoFile(
    root,
    'tests/api/get.test.ts',
    "import { rows } from '@/store/rows.js';\nit('AC-2 wires rows', () => rows);\n",
  );
  return { root, dir };
}

const CHANGED = [
  'src/store/rows.ts',
  'tests/store/rows.test.ts',
  'src/api/get.ts',
  'tests/api/get.test.ts',
];

function ctx(root: string, session: string, agentId: string | null, extra = {}) {
  return {
    projectRoot: root,
    sessionId: session,
    agentId,
    changedFiles: CHANGED,
    err: (l: string) => console.error(l),
    ...extra,
  };
}

const failing = { tests: () => ['tests: 1 failed'] };

describe('slice rows', () => {
  it('AC-2 refuses slice done without a passed gate on the current digest and records the gate', async () => {
    const { root, dir } = repo('ses-2');
    await runSlicePhase('start', 'store', ctx(root, 'ses-2', 'ag-store'));
    expect((await runSlicePhase('done', 'store', ctx(root, 'ses-2', 'ag-store'))).ok).toBe(false);
    const failed = await runSlicePhase(
      'gate',
      'store',
      ctx(root, 'ses-2', 'ag-store', { steps: failing }),
    );
    expect(failed.ok).toBe(false);
    const gate = readFeatureStageUnit(root, dir).find((row) => row.kind === 'slice_gate')!;
    expect(gate).toMatchObject({
      workstream: 'store',
      event_status: 'failed',
      failures: ['tests: 1 failed'],
    });
    expect(typeof gate.digest).toBe('string');
    expect((await runSlicePhase('gate', 'store', ctx(root, 'ses-2', 'ag-store'))).ok).toBe(true);
    writeRepoFile(root, 'src/store/rows.ts', 'export const rows = 2;\n');
    expect((await runSlicePhase('done', 'store', ctx(root, 'ses-2', 'ag-store'))).message).toMatch(
      /changed since/,
    );
    await runSlicePhase('gate', 'store', ctx(root, 'ses-2', 'ag-store'));
    expect((await runSlicePhase('done', 'store', ctx(root, 'ses-2', 'ag-store'))).ok).toBe(true);
  });

  it('AC-23 AC-35 refuses a second live start and an id missing from the compiled plan', async () => {
    const { root, dir } = repo('ses-23');
    expect((await runSlicePhase('start', 'store', ctx(root, 'ses-23', 'a1'))).ok).toBe(true);
    const again = await runSlicePhase('start', 'store', ctx(root, 'ses-23', 'a2'));
    expect(again.message).toMatch(/already running under agent a1/);
    const before = readFeatureStageUnit(root, dir).length;
    expect((await runSlicePhase('start', 'nope', ctx(root, 'ses-23', 'a3'))).ok).toBe(false);
    rmSync(join(root, featureFilePath(dir, 'plan')));
    expect((await runSlicePhase('start', 'api', ctx(root, 'ses-23', 'a4'))).message).toMatch(
      /plan compile/,
    );
    expect(readFeatureStageUnit(root, dir)).toHaveLength(before);
  });

  it('AC-14 AC-36 refuses a slice agent and the lead with open slices or an open seam', async () => {
    const { root, dir } = repo('ses-14');
    await runSlicePhase('start', 'store', ctx(root, 'ses-14', 'ag-s'));
    await runSlicePhase('start', 'api', ctx(root, 'ses-14', 'ag-a'));
    expect(developmentEndCheck(root, 'ses-14', 'ag-s')).toMatch(
      /slice agent cannot end development/,
    );
    expect(
      readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_end_refused'),
    ).toMatchObject({
      agent_id: 'ag-s',
      workstream: 'store',
    });
    expect(developmentEndCheck(root, 'ses-14', null)).toMatch(/slices not done: store, api/);
    for (const id of ['store', 'api']) {
      await runSlicePhase('gate', id, ctx(root, 'ses-14', null));
      await runSlicePhase('done', id, ctx(root, 'ses-14', null));
    }
    expect(developmentEndCheck(root, 'ses-14', null)).toMatch(/open seams: rows/);
    await runSlicePhase('start', 'join-wiring', ctx(root, 'ses-14', 'ag-j'));
    await runSlicePhase('gate', 'join-wiring', ctx(root, 'ses-14', 'ag-j'));
    await runSlicePhase('done', 'join-wiring', ctx(root, 'ses-14', 'ag-j'));
    expect(developmentEndCheck(root, 'ses-14', null)).toBeNull();
  });

  it('AC-24 AC-7 escalates a routine slice after two failures, never a high slice', async () => {
    const { root } = repo('ses-24');
    await runSlicePhase('start', 'store', ctx(root, 'ses-24', 'h'));
    await runSlicePhase('start', 'api', ctx(root, 'ses-24', 'r'));
    const view = () => slicesSettings(root, 'ses-24')!;
    expect(view()).toEqual([
      {
        id: 'store',
        risk: 'high',
        model: 'inherit',
        effort: 'high',
        gate_failures: 0,
        escalated: false,
      },
      {
        id: 'api',
        risk: 'routine',
        model: 'sonnet',
        effort: 'medium',
        gate_failures: 0,
        escalated: false,
      },
    ]);
    await runSlicePhase('gate', 'api', ctx(root, 'ses-24', 'r', { steps: failing }));
    expect(view()[1]!.escalated).toBe(false);
    await runSlicePhase('gate', 'api', ctx(root, 'ses-24', 'r', { steps: failing }));
    expect(view()[1]).toMatchObject({ model: 'inherit', effort: 'high', escalated: true });
    await runSlicePhase('gate', 'store', ctx(root, 'ses-24', 'h', { steps: failing }));
    await runSlicePhase('gate', 'store', ctx(root, 'ses-24', 'h', { steps: failing }));
    expect(view()[0]).toMatchObject({ model: 'inherit', escalated: false, gate_failures: 2 });
    expect(existsSync(join(root, '.paqad/configs'))).toBe(false);
  });

  it('AC-21 AC-45 an escalated routine slice failing again raises a scoped packet and shows BLOCKED', async () => {
    const { root } = repo('ses-21');
    await runSlicePhase('start', 'api', ctx(root, 'ses-21', 'r'));
    await runSlicePhase('start', 'store', ctx(root, 'ses-21', 'h'));
    for (let i = 0; i < 2; i += 1) {
      await runSlicePhase('gate', 'api', ctx(root, 'ses-21', 'r', { steps: failing }));
    }
    const last = await runSlicePhase('gate', 'api', ctx(root, 'ses-21', 'r', { steps: failing }));
    expect(last.packet).toMatch(/^D-/);
    const packet = readContractDecisions(root).find(({ packet: p }) => p.id === last.packet)!;
    expect(packet.status).toBe('pending');
    expect(packet.packet).toMatchObject({ workstream: 'api' });
    expect(packet.packet.title).toContain('api');
    await runSlicePhase('gate', 'store', ctx(root, 'ses-21', 'h'));
    await runSlicePhase('done', 'store', ctx(root, 'ses-21', 'h'));
    const report = slicesReport(root, 'ses-21')!;
    expect(report.find((r) => r.id === 'api')).toMatchObject({
      status: 'BLOCKED',
      gate_failures: 3,
      escalated: true,
    });
    const store = report.find((r) => r.id === 'store')!;
    expect(store.status).toBe('DONE');
    expect(typeof store.wall_clock_ms).toBe('number');
    expect(developmentEndCheck(root, 'ses-21', null)).toMatch(/api/);
  });

  it('AC-22 a new lead session keeps done slices and dispatches the rest again with one line', async () => {
    const { root, dir } = repo('ses-22');
    for (const id of ['store', 'api', 'join-wiring']) {
      await runSlicePhase('start', id, ctx(root, 'ses-22', `ag-${id}`));
    }
    for (const id of ['store', 'join-wiring']) {
      await runSlicePhase('gate', id, ctx(root, 'ses-22', `ag-${id}`));
      await runSlicePhase('done', id, ctx(root, 'ses-22', `ag-${id}`));
    }
    const resume = resumeFanOut(readFeatureStageUnit(root, dir));
    expect(resume.kept).toEqual(['store', 'join-wiring']);
    expect(resume.redispatch).toEqual([
      { id: 'api', handback: '.paqad/tmp/slice-api-progress.md' },
    ]);
    expect(resume.line.split('\n')).toHaveLength(1);
  });

  it('AC-20 a slice whose agent stopped or went quiet for 60 minutes stops counting as running', async () => {
    const { root, dir } = repo('ses-20');
    await runSlicePhase('start', 'store', ctx(root, 'ses-20', 'ag-quiet'));
    const { runningSlices, deadSlices } = await import('@/stage-evidence/slices.js');
    const rows = readFeatureStageUnit(root, dir);
    expect(runningSlices(rows, Date.now()).map((s) => s.id)).toEqual(['store']);
    expect(deadSlices(rows, Date.now() + DEAD_SLICE_MS).map((s) => s.id)).toEqual(['store']);
    appendFeatureStageRow(root, 'ses-20', dir, {
      kind: 'stage-agent',
      agent: 'paqad-development',
      agent_id: 'ag-quiet',
      stage: 'development',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
    expect(deadSlices(readFeatureStageUnit(root, dir), Date.now()).map((s) => s.id)).toEqual([
      'store',
    ]);
    expect(developmentEndCheck(root, 'ses-20', null)).toMatch(/store/);
  });
});

describe('slice write guard', () => {
  async function write(root: string, session: string, agentId: string, file: string) {
    const { runCapabilityGate } = await import('@/kernel/gate.js');
    return runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { CLAUDE_SESSION_ID: session },
      payload: {
        toolName: 'Edit',
        targetPath: join(root, file),
        agentType: 'paqad:paqad-development',
        agentId,
        sessionId: session,
      },
    });
  }

  it('AC-37 refuses a slice agent edit outside its owned files or on a lead-owned file', async () => {
    const { root } = repo('ses-37');
    await runSlicePhase('start', 'store', ctx(root, 'ses-37', 'ag-store'));
    const outside = await write(root, 'ses-37', 'ag-store', 'src/api/get.ts');
    expect(outside.block).toBe(true);
    expect(outside.summary).toContain('src/api/get.ts');
    expect(outside.summary).toContain('store');
    expect((await write(root, 'ses-37', 'ag-store', 'src/index.ts')).block).toBe(true);
    const own = await write(root, 'ses-37', 'ag-store', 'src/store/rows.ts');
    expect(own.summary).not.toContain('writes only its own files');
    const progress = await write(root, 'ses-37', 'ag-store', '.paqad/tmp/slice-store-progress.md');
    expect(progress.summary).not.toContain('writes only its own files');
    const lead = await write(root, 'ses-37', 'ag-lead', 'src/api/get.ts');
    expect(lead.summary).not.toContain('writes only its own files');
  });
});

describe('slice gate', () => {
  it('AC-11 fails a seam test that mocks or skips the entry file and passes a real import', () => {
    const { root } = repo('ses-11');
    const seam = [{ name: 'rows', entry_file: 'src/store/rows.ts', wired_ac: 'AC-2' }];
    expect(wiredFailures(root, seam, ['tests/api/get.test.ts'])).toEqual([]);
    writeRepoFile(
      root,
      'tests/api/get.test.ts',
      "import { rows } from '@/store/rows.js';\nvi.mock('@/store/rows.js');\nit('AC-2 wires', () => rows);\n",
    );
    expect(wiredFailures(root, seam, ['tests/api/get.test.ts'])[0]).toMatch(/AC-2/);
    writeRepoFile(root, 'tests/api/get.test.ts', "it('AC-2 wires', () => 1);\n");
    expect(wiredFailures(root, seam, ['tests/api/get.test.ts'])[0]).toMatch(/AC-2/);
  });

  it('AC-16 AC-26 fails a test that spawns a full suite, build or lint and passes paqad-ai and git', () => {
    const { root } = repo('ses-16');
    writeRepoFile(root, 'tests/api/heavy.test.ts', "execSync('pnpm test');\n");
    writeRepoFile(root, 'tests/api/build.test.ts', "spawn('pnpm', ['run', 'build']);\n");
    writeRepoFile(
      root,
      'tests/api/light.test.ts',
      "spawnSync('paqad-ai', ['stage', 'slice', 'gate']);\nexecFileSync('git', ['status']);\n",
    );
    expect(heavyRunFailures(root, ['tests/api/heavy.test.ts', 'tests/api/build.test.ts'])).toEqual([
      'heavy run: tests/api/heavy.test.ts starts a full suite, build or lint run',
      'heavy run: tests/api/build.test.ts starts a full suite, build or lint run',
    ]);
    expect(heavyRunFailures(root, ['tests/api/light.test.ts'])).toEqual([]);
  });

  it('AC-34 fails a gate past 10 minutes naming its slowest step and counts it as a failure', async () => {
    const { root, dir } = repo('ses-34');
    await runSlicePhase('start', 'api', ctx(root, 'ses-34', 'r'));
    let clock = 0;
    const result = await runSlicePhase(
      'gate',
      'api',
      ctx(root, 'ses-34', 'r', {
        nowMs: () => clock,
        steps: {
          typecheck: () => {
            clock += 11 * 60 * 1000;
            return [];
          },
        },
      }),
    );
    expect(result.message).toMatch(/slowest step: typecheck/);
    expect(slicesSettings(root, 'ses-34')!.find((s) => s.id === 'api')!.gate_failures).toBe(1);
    expect(readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_gate')).toMatchObject({
      slowest_step: 'typecheck',
    });
  });

  it('AC-39 never touches .git/index and removes its temporary index on pass and on fail', async () => {
    const { root } = repo('ses-39');
    const index = join(root, '.git', 'index');
    const before = readFileSync(index);
    const mtime = statSync(index).mtimeMs;
    const subject = {
      id: 'store',
      owned_files: ['src/store/**', 'tests/store/**'],
      acs: ['AC-1'],
      seams: [],
    };
    const pass = await runSliceGate({ projectRoot: root, subject, changedFiles: CHANGED });
    const fail = await runSliceGate({
      projectRoot: root,
      subject,
      changedFiles: CHANGED,
      steps: failing,
    });
    expect(pass.passed).toBe(true);
    expect(fail.passed).toBe(false);
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(mtime);
    expect(existsSync(join(root, '.git', 'index.lock'))).toBe(false);
    const tmp = join(root, '.paqad', 'tmp');
    expect(
      existsSync(tmp) ? readdirSync(tmp).filter((n) => n.startsWith('slice-gate-')) : [],
    ).toEqual([]);
  });
});

describe('lead guide', () => {
  it('AC-44 prints the lead guide and keeps it out of the development recipe', () => {
    const guide = leadGuideText();
    expect(guide).toContain('# Lead developer guide');
    expect(
      readFileSync(join(process.cwd(), 'runtime/base/skills/development-recipe/SKILL.md'), 'utf8'),
    ).not.toContain('Lead developer guide');
  });
});

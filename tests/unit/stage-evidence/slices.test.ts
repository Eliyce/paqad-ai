import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { DEAD_SLICE_MS, resumeFanOut, sliceEndCommandRefusal } from '@/stage-evidence/slices.js';

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

  it('AC-14 refuses a slice agent by its hook agent id or workstream even with SE_AGENT_ID unset', async () => {
    const { root, dir } = repo('ses-14b');
    await runSlicePhase('start', 'store', ctx(root, 'ses-14b', 'ag-s'));
    const refused = () =>
      readFeatureStageUnit(root, dir).filter((r) => r.kind === 'slice_end_refused');
    expect(developmentEndCheck(root, 'ses-14b', null, 'store')).toMatch(
      /slice agent cannot end development/,
    );
    expect(refused().at(-1)).toMatchObject({ agent_id: 'ag-s', workstream: 'store' });
    expect(
      sliceEndCommandRefusal({
        projectRoot: root,
        sessionId: 'ses-14b',
        agentId: 'ag-s',
        command: 'SE_AGENT_ID= paqad-ai stage end development --agent paqad-development',
      }),
    ).toMatch(/slice agent cannot end development/);
    expect(refused()).toHaveLength(2);
    expect(
      sliceEndCommandRefusal({
        projectRoot: root,
        sessionId: 'ses-14b',
        agentId: 'ag-lead',
        command: 'paqad-ai stage end development',
      }),
    ).toBeNull();
    expect(
      sliceEndCommandRefusal({
        projectRoot: root,
        sessionId: 'ses-14b',
        agentId: 'ag-s',
        command: 'paqad-ai stage slice done store',
      }),
    ).toBeNull();
    expect(refused()).toHaveLength(2);
  });

  it('AC-14 the Bash hook blocks a slice agent running stage end development by its payload agent id', async () => {
    const { root, dir } = repo('ses-14c');
    await runSlicePhase('start', 'store', ctx(root, 'ses-14c', 'ag-s'));
    const { main } = await import('../../../runtime/hooks/stage-agent-write-guard.mjs');
    const payload = (agentId: string, command: string) =>
      JSON.stringify({
        tool_name: 'Bash',
        session_id: 'ses-14c',
        cwd: root,
        agent_id: agentId,
        agent_type: 'paqad-development',
        tool_input: { command },
      });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main(payload('ag-s', 'env -u SE_AGENT_ID paqad-ai stage end development'))).toBe(
        2,
      );
      expect(String(stderr.mock.calls.at(-1)?.[0])).toMatch(/slice agent cannot end development/);
      expect(await main(payload('ag-other', 'paqad-ai stage end development'))).toBe(0);
    } finally {
      stderr.mockRestore();
    }
    expect(
      readFeatureStageUnit(root, dir).filter((r) => r.kind === 'slice_end_refused'),
    ).toHaveLength(1);
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

describe('stop deferral while slices run', () => {
  async function stop(root: string, session: string, nowMs = Date.now()) {
    const { deferCompletionForBackgroundStage } =
      await import('@/stage-evidence/completion-deferred.js');
    return deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: session,
      adapter: 'claude-code',
      now: () => new Date(nowMs),
    });
  }

  it('AC-5 defers with slices running and judges again after the lead ends development', async () => {
    const { root, dir } = repo('ses-5');
    await runSlicePhase('start', 'store', ctx(root, 'ses-5', 'ag-store'));
    expect(await stop(root, 'ses-5')).toMatchObject({ deferred: true, reason: 'slices running' });
    const deferred = readFeatureStageUnit(root, dir).filter(
      (row) => row.kind === 'completion-deferred',
    );
    expect(deferred.at(-1)).toMatchObject({ reason: 'slices running', tasks: 1 });
    appendFeatureStageRow(root, 'ses-5', dir, {
      kind: 'stage_end',
      stage: 'development',
      event_status: 'completed',
      evidence_source: 'live-mark',
    });
    expect((await stop(root, 'ses-5')).reason).not.toBe('slices running');
  });

  it('AC-20 stops deferring for a slice quiet for 60 minutes and names it', async () => {
    const { root } = repo('ses-20b');
    await runSlicePhase('start', 'store', ctx(root, 'ses-20b', 'ag-store'));
    const later = Date.now() + DEAD_SLICE_MS + 1000;
    const result = await stop(root, 'ses-20b', later);
    expect(result.reason).not.toBe('slices running');
    expect(result.stoppedSlices).toEqual(['store']);
    expect(result.stoppedSlicesNote).toContain('store');
    expect(developmentEndCheck(root, 'ses-20b', null)).toMatch(/store/);
  });

  it('AC-5 AC-20 defers again when development is reopened for a fix pass and fans out again', async () => {
    const { root, dir } = repo('ses-reopen');
    const mark = (kind: string) =>
      appendFeatureStageRow(root, 'ses-reopen', dir, {
        kind,
        stage: 'development',
        event_status: 'completed',
        evidence_source: 'live-mark',
      });
    mark('stage_start');
    await runSlicePhase('start', 'api', ctx(root, 'ses-reopen', 'ag-old'));
    mark('stage_end');
    expect((await stop(root, 'ses-reopen')).reason).not.toBe('slices running');
    mark('stage_start');
    expect(developmentEndCheck(root, 'ses-reopen', null)).toBeNull();
    await runSlicePhase('start', 'store', ctx(root, 'ses-reopen', 'ag-fix'));
    expect(await stop(root, 'ses-reopen')).toMatchObject({
      deferred: true,
      reason: 'slices running',
    });
    const refusal = developmentEndCheck(root, 'ses-reopen', null);
    expect(refusal).toMatch(/slices not done: store(;|$)/);
    expect(refusal).not.toMatch(/api/);
  });

  it('AC-20 AC-21 a slice dropped through its packet no longer blocks Stop or the lead stage end', async () => {
    const { root, dir } = repo('ses-drop');
    const { resolvePendingDecision } = await import('@/decisions/authoring.js');
    await runSlicePhase('start', 'api', ctx(root, 'ses-drop', 'ag-api'));
    let packet: string | undefined;
    for (let i = 0; i < 3; i += 1) {
      packet = (
        await runSlicePhase('gate', 'api', ctx(root, 'ses-drop', 'ag-api', { steps: failing }))
      ).packet;
    }
    expect(packet).toMatch(/^D-/);
    for (const id of ['store', 'join-wiring']) {
      await runSlicePhase('start', id, ctx(root, 'ses-drop', `ag-${id}`));
      await runSlicePhase('gate', id, ctx(root, 'ses-drop', `ag-${id}`));
      await runSlicePhase('done', id, ctx(root, 'ses-drop', `ag-${id}`));
    }
    appendFeatureStageRow(root, 'ses-drop', dir, {
      kind: 'stage-agent',
      agent: 'paqad-development',
      agent_id: 'ag-api',
      stage: 'development',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
    expect((await stop(root, 'ses-drop')).stoppedSlices).toEqual(['api']);
    expect(developmentEndCheck(root, 'ses-drop', null)).toMatch(/api/);
    resolvePendingDecision(root, packet!, 'drop', 'not needed');
    expect((await stop(root, 'ses-drop')).stoppedSlices).toBeUndefined();
    expect(developmentEndCheck(root, 'ses-drop', null)).toBeNull();
  });

  it('AC-21 a slice dispatched again starts with a fresh failure count and blocks again', async () => {
    const { root } = repo('ses-again');
    await runSlicePhase('start', 'api', ctx(root, 'ses-again', 'ag-1'));
    for (let i = 0; i < 3; i += 1) {
      await runSlicePhase('gate', 'api', ctx(root, 'ses-again', 'ag-1', { steps: failing }));
    }
    expect(slicesReport(root, 'ses-again')![0]).toMatchObject({ status: 'BLOCKED' });
    await runSlicePhase(
      'start',
      'api',
      ctx(root, 'ses-again', 'ag-2', { nowMs: () => Date.now() + DEAD_SLICE_MS + 1000 }),
    );
    expect(slicesReport(root, 'ses-again')![0]).toMatchObject({
      status: 'RUNNING',
      gate_failures: 0,
    });
    const first = await runSlicePhase(
      'gate',
      'api',
      ctx(root, 'ses-again', 'ag-2', { steps: failing }),
    );
    expect(first.packet).toBeUndefined();
    expect(developmentEndCheck(root, 'ses-again', null)).toMatch(/api/);
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

describe('slice handback', () => {
  it('AC-40 accepts a slice agent handback on its slice_done row with no stage end row', async () => {
    const { decideHandback } = await import('@/stage-isolation/stage-handback.js');
    const { root, dir } = repo('ses-40');
    await runSlicePhase('start', 'store', ctx(root, 'ses-40', 'ag-store'));
    const payload = {
      agent_type: 'paqad:paqad-development',
      agent_id: 'ag-store',
      session_id: 'ses-40',
      tool_input: { message: 'Built the store slice.\nStatus: DONE' },
    };
    const early = decideHandback({ projectRoot: root, payload });
    expect(early.exit).toBe(2);
    expect(early.reason).toContain('stage slice done store');
    expect(early.reason).not.toContain('stage end');
    await runSlicePhase('gate', 'store', ctx(root, 'ses-40', 'ag-store'));
    expect((await runSlicePhase('done', 'store', ctx(root, 'ses-40', 'ag-store'))).ok).toBe(true);
    expect(decideHandback({ projectRoot: root, payload }).exit).toBe(0);
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.some((row) => row.kind === 'stage_end' && row.stage === 'development')).toBe(false);
  });
});

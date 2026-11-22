import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  DEAD_SLICE_MS,
  currentDevelopmentRows,
  deadSlices,
  developmentEndRefusal,
  droppedSlices,
  foldSlices,
  openSeams,
  packetBlocksFile,
  readCompiledSlicing,
  resumeFanOut,
  scopedPacketsBlocking,
  sliceDoneRefusal,
  sliceEndCommandRefusal,
  sliceOfAgent,
  sliceOwnedFiles,
  sliceReport,
  sliceRisk,
  sliceScopeFiles,
  sliceStartRefusal,
  sliceWriteRefusal,
  type CompiledSlicing,
} from '@/stage-evidence/slices.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function ws(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    owned_files: [`src/${id}/**`],
    acs: [],
    depends_on: [],
    provides_seams: [],
    uses_seams: [],
    risk: 'high' as const,
    size_budget: { files: 10 },
    ...extra,
  };
}

const SLICING: CompiledSlicing = {
  workstreams: [
    ws('store', {
      provides_seams: [{ name: 'rows', entry_file: 'src/store/rows.ts', wired_ac: 'AC-2' }],
    }),
    ws('api', { uses_seams: ['rows'], risk: 'routine' }),
    ws('ui'),
  ],
  waves: [['store'], ['api', 'ui']],
  joining: [{ id: 'join-wiring', area: 'wiring', owned_files: ['src/index.ts'] }],
};

function row(kind: string, fields: Record<string, unknown> = {}): SessionLedgerRow {
  return {
    schema_version: 1,
    doc_type: 'paqad.stage',
    session_id: 's',
    ts: '',
    content_hash: '',
    kind,
    ...fields,
  } as SessionLedgerRow;
}

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:05:00.000Z';

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-slices-'));
  roots.push(root);
  return root;
}

function changeRepo(session: string, plan: unknown): { root: string; dir: string } {
  const root = makeEmptyRepo('main');
  roots.push(root);
  writeRepoFile(root, 'README.md', 'x\n');
  commitAll(root, 'base');
  const dir = openChange(root, session);
  writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify(plan));
  return { root, dir };
}

describe('compiled slicing reader', () => {
  it('AC-1 returns null for a missing, unparsable or workstream-free plan and fills absent lists', () => {
    const { root, dir } = changeRepo('ses-read', { summary: 's' });
    expect(readCompiledSlicing(root, dir)).toBeNull();
    writeFileSync(join(root, featureFilePath(dir, 'plan')), '{not json');
    expect(readCompiledSlicing(root, dir)).toBeNull();
    writeFileSync(
      join(root, featureFilePath(dir, 'plan')),
      JSON.stringify({ workstreams: [ws('store')] }),
    );
    expect(readCompiledSlicing(root, dir)).toEqual({
      workstreams: [ws('store')],
      waves: [],
      joining: [],
    });
    expect(readCompiledSlicing(tempRoot(), dir)).toBeNull();
  });

  it('AC-1 resolves owned files, scope and risk for workstreams, joining entries and unknown ids', () => {
    expect(sliceOwnedFiles(SLICING, 'join-wiring')).toEqual(['src/index.ts']);
    expect(sliceOwnedFiles(SLICING, 'nope')).toBeNull();
    expect(sliceScopeFiles(SLICING, 'nope')).toBeNull();
    expect(sliceRisk(SLICING, 'api')).toBe('routine');
    expect(sliceRisk(SLICING, 'join-wiring')).toBe('high');
  });
});

describe('slice fold', () => {
  it('AC-18 keeps rows without a timestamp or agent and ignores rows for unknown slices', () => {
    const rows = [
      row('slice_start', { workstream: 'store', ts: 'garbage' }),
      row('slice_gate', { workstream: 'store', event_status: 'failed', failures: 'not-a-list' }),
      row('slice_gate', { workstream: 'ghost', event_status: 'failed' }),
      row('note', { agent_id: 'nobody' }),
      row('note'),
      row('slice_done', { workstream: 'store' }),
    ];
    const state = foldSlices(rows).get('store')!;
    expect(state).toMatchObject({
      agent_id: null,
      started_at: 'garbage',
      last_row_at: null,
      gate_failures: 1,
      last_gate_failures: [],
      done: true,
      done_at: null,
    });
    expect(
      foldSlices([row('slice_start', { workstream: 'x', ts: undefined })]).get('x'),
    ).toMatchObject({ started_at: null, last_started_at: null });
    expect(foldSlices(rows).has('ghost')).toBe(false);
  });

  it('AC-20 keeps the last row time when a later agent row has no timestamp', () => {
    const rows = [
      row('slice_start', { workstream: 'store', agent_id: 'a1', recorded_at: T0 }),
      row('note', { agent_id: 'a1', ts: 'not-a-date' }),
      row('stage-agent', { agent_id: 'a2', workstream: 'store' }),
    ];
    const state = foldSlices(rows).get('store')!;
    expect(state.last_row_at).toBe(Date.parse(T0));
    expect(state.stopped).toBe(false);
  });

  it('AC-22 scopes rows to the current development run and reports whether it ended', () => {
    const plain = [row('note')];
    expect(currentDevelopmentRows(plain)).toBe(plain);
    const once = [row('stage_start', { stage: 'development' }), row('note')];
    expect(currentDevelopmentRows(once)).toBe(once);
    const twice = [
      row('stage_start', { stage: 'development' }),
      row('slice_start', { workstream: 'old' }),
      row('stage_end', { stage: 'development' }),
      row('stage_start', { stage: 'development' }),
    ];
    expect(currentDevelopmentRows(twice)).toEqual([twice[3]]);
    expect(sliceOfAgent(twice, null)).toBeNull();
    expect(sliceOfAgent(twice, 'missing')).toBeNull();
  });
});

describe('slice start and done refusals', () => {
  it('AC-23 names an unknown agent for a running slice started without one', () => {
    const rows = [row('slice_start', { workstream: 'store', recorded_at: T0 })];
    expect(sliceStartRefusal(SLICING, 'store', rows, Date.parse(T1))).toMatch(
      /already running under agent unknown/,
    );
    expect(sliceStartRefusal(SLICING, 'ui', rows, Date.parse(T1))).toBeNull();
    expect(sliceStartRefusal(SLICING, 'store', rows, Date.parse(T0) + DEAD_SLICE_MS)).toBeNull();
  });

  it('AC-2 refuses slice done for a slice that never started', () => {
    expect(sliceDoneRefusal([], 'store', 'd')).toMatch(/no slice_start row/);
  });
});

describe('seams and the lead stage end', () => {
  it('AC-36 skips dropped providers and dropped joining entries when listing open seams', () => {
    const rows = [row('slice_start', { workstream: 'store', recorded_at: T0 })];
    expect(openSeams(SLICING, rows)).toEqual(['rows']);
    expect(openSeams(SLICING, rows, new Set(['store']))).toEqual([]);
    expect(openSeams(SLICING, rows, new Set(['join-wiring']))).toEqual([]);
  });

  it('AC-36 a seam with no joining entry closes when its provider is done', () => {
    const noJoin = { ...SLICING, joining: [] };
    const rows = [row('slice_start', { workstream: 'store', recorded_at: T0 })];
    expect(openSeams(noJoin, rows)).toEqual(['rows']);
    expect(openSeams(noJoin, [...rows, row('slice_done', { workstream: 'store' })])).toEqual([]);
  });

  it('AC-36 without a compiled plan the lead is held only by open slices', () => {
    const rows = [row('slice_start', { workstream: 'store', agent_id: 'a1' })];
    expect(developmentEndRefusal(null, rows, 'lead')).toMatchObject({
      kind: 'lead',
      slices: ['store'],
      seams: [],
    });
    const done = [...rows, row('slice_done', { workstream: 'store' })];
    expect(developmentEndRefusal(null, done, 'lead')).toBeNull();
  });
});

describe('slice report and resume', () => {
  it('AC-45 reports no wall clock for a slice without timestamps and resumes an empty fan-out', () => {
    const rows = [row('slice_start', { workstream: 'ghost-free' })];
    expect(sliceReport(SLICING, rows)).toEqual([
      {
        id: 'ghost-free',
        status: 'RUNNING',
        wall_clock_ms: null,
        gate_failures: 0,
        escalated: false,
      },
    ]);
    expect(resumeFanOut([]).line).toBe(
      'resumed the fan-out: kept 0 done slice(s), dispatch 0 again',
    );
  });

  it('AC-20 counts a stopped slice as dead and leaves a dropped one out', () => {
    const rows = [
      row('slice_start', { workstream: 'store', agent_id: 'a1', recorded_at: T0 }),
      row('stage-handback', { agent_id: 'a1' }),
    ];
    expect(deadSlices(rows, Date.parse(T1)).map((s) => s.id)).toEqual(['store']);
    expect(deadSlices(rows, Date.parse(T1), new Set(['store']))).toEqual([]);
  });
});

describe('dropped slices', () => {
  function packet(root: string, name: string, status: string, fields: Record<string, unknown>) {
    const dir = join(root, '.paqad', 'decisions', status);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(fields));
  }

  it('AC-21 drops only a running slice whose resolved drop packet is newer than its start', () => {
    const root = tempRoot();
    const dirName = 'some-change-01ABC';
    const change = featureChangeKey(dirName);
    const rows = [
      row('slice_start', { workstream: 'store', recorded_at: T0 }),
      row('slice_start', { workstream: 'api', recorded_at: T1 }),
      row('slice_start', { workstream: 'ui' }),
      row('slice_start', { workstream: 'done' }),
      row('slice_done', { workstream: 'done' }),
    ];
    const resolved = { chosen: 'drop', change, resolved_at: T1 };
    packet(root, 'a', 'pending', { ...resolved, workstream: 'ui' });
    packet(root, 'b', 'resolved', { ...resolved, chosen: 'keep', workstream: 'ui' });
    packet(root, 'c', 'resolved', { ...resolved, change: 'other', workstream: 'ui' });
    packet(root, 'd', 'resolved', { ...resolved });
    packet(root, 'e', 'resolved', { ...resolved, workstream: 'ghost' });
    packet(root, 'f', 'resolved', { ...resolved, workstream: 'done' });
    packet(root, 'g', 'resolved', { chosen: 'drop', change, workstream: 'api' });
    packet(root, 'h', 'resolved', { ...resolved, resolved_at: T0, workstream: 'api' });
    packet(root, 'i', 'resolved', { ...resolved, workstream: 'store' });
    packet(root, 'j', 'resolved', { ...resolved, workstream: 'ui' });
    expect([...droppedSlices(root, dirName, rows)].sort()).toEqual(['store', 'ui']);
  });
});

describe('scoped packets', () => {
  it('AC-28 AC-30 lets a scoped packet through only for files outside its scope and seams', () => {
    expect(packetBlocksFile(SLICING, 'store', 'README.md')).toBe(true);
    expect(packetBlocksFile(SLICING, 'store', 'src/store/a.ts')).toBe(true);
    expect(packetBlocksFile(SLICING, 'store', 'src/api/a.ts')).toBe(true);
    expect(packetBlocksFile(SLICING, 'store', 'src/ui/a.ts')).toBe(false);
    expect(packetBlocksFile(SLICING, 'ghost', 'src/api/a.ts')).toBe(false);
  });

  it('AC-28 AC-31 records an allowed edit only when no packet blocks it', () => {
    const { root, dir } = changeRepo('ses-scoped', { summary: 's', ...SLICING });
    const scoped = { id: 'D-1', workstream: 'store' };
    expect(
      scopedPacketsBlocking({
        projectRoot: root,
        sessionId: 'ses-scoped',
        packets: [scoped, { id: 'D-2', workstream: null }],
        targets: ['src/ui/a.ts'],
      }),
    ).toEqual(['D-2']);
    expect(readFeatureStageUnit(root, dir).some((r) => r.kind === 'slice_edit_allowed')).toBe(
      false,
    );
    expect(
      scopedPacketsBlocking({
        projectRoot: root,
        sessionId: 'ses-scoped',
        packets: [scoped],
        targets: [],
      }),
    ).toEqual(['D-1']);
    expect(
      scopedPacketsBlocking({
        projectRoot: root,
        sessionId: 'ses-scoped',
        packets: [scoped],
        targets: [join(root, 'src', 'ui', 'a.ts')],
      }),
    ).toEqual([]);
    expect(
      readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_edit_allowed'),
    ).toMatchObject({ workstream: 'store', decision: 'D-1', files: ['src/ui/a.ts'] });
  });

  it('AC-28 blocks every scoped packet when no change or plan is open', () => {
    const root = tempRoot();
    expect(
      scopedPacketsBlocking({
        projectRoot: root,
        sessionId: 'ses-none',
        packets: [{ id: 'D-1', workstream: 'store' }],
        targets: ['src/ui/a.ts'],
      }),
    ).toEqual(['D-1']);
  });
});

describe('slice write guard edges', () => {
  it('AC-27 passes without an agent, without a plan, outside the project and in scratch files', () => {
    const { root, dir } = changeRepo('ses-guard', { summary: 's', ...SLICING });
    appendFeatureStageRow(root, 'ses-guard', dir, {
      kind: 'slice_start',
      agent: 'paqad-development',
      agent_id: 'ag-ui',
      workstream: 'ui',
      stage: 'development',
    });
    appendFeatureStageRow(root, 'ses-guard', dir, {
      kind: 'slice_start',
      agent: 'paqad-development',
      agent_id: 'ag-gone',
      workstream: 'gone',
      stage: 'development',
    });
    const base = { projectRoot: root, dirName: dir };
    expect(sliceWriteRefusal({ ...base, agentId: null, targets: ['x.ts'] })).toBeNull();
    expect(sliceWriteRefusal({ ...base, agentId: 'lead', targets: ['x.ts'] })).toBeNull();
    expect(
      sliceWriteRefusal({
        ...base,
        agentId: 'ag-ui',
        targets: [
          join(root, 'src', 'ui', 'a.ts'),
          join(root, '..', 'elsewhere.ts'),
          '.paqad/tmp/slice-ui-progress.md',
        ],
      }),
    ).toBeNull();
    expect(sliceWriteRefusal({ ...base, agentId: 'ag-gone', targets: ['src/gone/a.ts'] })).toEqual({
      workstream: 'gone',
      target: 'src/gone/a.ts',
    });
    writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify({ summary: 's' }));
    expect(sliceWriteRefusal({ ...base, agentId: 'ag-ui', targets: ['README.md'] })).toBeNull();
  });
});

describe('slice end command refusal edges', () => {
  it('AC-14 ignores a missing agent, another command, no open change and a non-slice agent', () => {
    const { root, dir } = changeRepo('ses-cmd', { summary: 's', ...SLICING });
    const command = 'paqad-ai stage end development';
    const base = { projectRoot: root, sessionId: 'ses-cmd' };
    expect(sliceEndCommandRefusal({ ...base, agentId: undefined, command })).toBeNull();
    expect(sliceEndCommandRefusal({ ...base, agentId: '  ', command })).toBeNull();
    expect(sliceEndCommandRefusal({ ...base, agentId: 'a1', command: 42 })).toBeNull();
    expect(sliceEndCommandRefusal({ ...base, agentId: 'a1', command: 'ls' })).toBeNull();
    expect(sliceEndCommandRefusal({ ...base, agentId: 'lead', command })).toBeNull();
    expect(
      sliceEndCommandRefusal({ projectRoot: tempRoot(), sessionId: 'x', agentId: 'a1', command }),
    ).toBeNull();
    appendFeatureStageRow(root, 'ses-cmd', dir, {
      kind: 'slice_start',
      agent: 'paqad-development',
      agent_id: 'a1',
      workstream: 'ui',
      stage: 'development',
    });
    expect(
      sliceEndCommandRefusal({ projectRoot: root, sessionId: null, agentId: 'a1', command }),
    ).toMatch(/stage slice done ui/);
    expect(
      readFeatureStageUnit(root, dir).find((r) => r.kind === 'slice_end_refused'),
    ).toMatchObject({ agent_id: 'a1', workstream: 'ui' });
  });
});

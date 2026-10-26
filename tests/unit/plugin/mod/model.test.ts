import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { hudReceiptPath, hudSnapshotPath } from '@/hud/files.js';
import { writeHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';
import type { FoldedChange, FoldedStage } from '@/stage-evidence/types.js';
import { formatStageEvidenceReceipt } from '@/verification/repository/receipt.js';

import {
  BAND_STATES,
  NOT_YET,
  STAGE_ORDER,
  bandState,
  bandTone,
  buildBandView,
  costPill,
  flagPill,
  formatClock,
  isLive,
  isRefreshTool,
  isStageAgent,
  joinPath,
  liveClock,
  parseSnapshot,
  receiptPath,
  safeSessionId,
  snapshotPath,
  stageSegments,
} from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  GRADUATED_ORD_482,
  NOW,
  STATE_FIXTURES,
  costRecord,
  fileText,
  snapshot,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadHudSnapshot } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

const parse = (raw: Record<string, unknown>): PaqadHudSnapshot => parseSnapshot(fileText(raw))!;

describe('parseSnapshot', () => {
  it.each([
    ['nothing', undefined],
    ['an empty file', ''],
    ['a blank file', '  \n'],
    ['half a file', '{"schema":"paqad.hud/2","headl'],
    ['a list', '[]'],
    ['another schema', '{"schema":"paqad.other/1"}'],
    ['no schema', '{"active":true}'],
  ])('reads %s as null ("not yet")', (_name, text) => {
    expect(parseSnapshot(text)).toBeNull();
  });

  it('reads every fixture whole', () => {
    const full = parse(FULL_ORD_501);
    expect(full).toMatchObject({
      active: true,
      lane: 'full',
      headline: { text: 'Safe to merge. 1 flag open.', tone: 'warn' },
      change: { issue: 'ORD-501', branch: 'feat/ORD-501-csv-export' },
      flags: [{ id: 'near-copies' }],
      findings: { near_copies: { status: 'open', total: 1, blocking: false } },
      ship: { commits: 3, push: null, pr: null, ci: null, merge_commit: null },
      verdict: { word: 'Safe to merge', kind: 'pass', reasons: [] },
    });
    expect(full.stages).toHaveLength(8);
  });

  it('AC-1, AC-19: keeps a finished change on screen with its verdict and rung, never idle', () => {
    const finished = parse({
      ...FULL_ORD_501,
      scope: { qualified: true, reason: 'finished' },
      rung: 'done',
    });
    expect(finished).toMatchObject({
      scope: { qualified: true, reason: 'finished' },
      active: true,
      change: { issue: 'ORD-501' },
      verdict: { kind: 'pass' },
      rung: 'done',
    });
    const closed = parse({ ...FULL_ORD_501, scope: { qualified: false, reason: 'closed' } });
    expect(closed).toMatchObject({ active: false, change: null, verdict: null });
    expect(closed.rung).toBeUndefined();
  });

  it('reads an unknown rung as absent, never as a rung', () => {
    expect(parse({ ...FULL_ORD_501, rung: 'shipped' }).rung).toBeUndefined();
    expect(parse({ ...FULL_ORD_501, verdict_stale: 'yes' }).verdict_stale).toBeUndefined();
  });

  it('reads a paqad.hud/2 snapshot, which has no scope, as idle', () => {
    const legacy = parseSnapshot(
      JSON.stringify({ ...FULL_ORD_501, schema: 'paqad.hud/2', scope: undefined }),
    )!;
    expect(legacy).toMatchObject({
      scope: { qualified: false, reason: 'no scope recorded' },
      active: false,
      change: null,
      stages: [],
      flags: [],
      ship: null,
      verdict: null,
      cost: null,
      decisions: { pending: [], resolved: 0 },
    });
  });

  it('the previous mod reader took paqad.hud/3 snapshots without throwing', () => {
    interface OldReading {
      threw: string | null;
      parsed: boolean;
      headline: string;
      stages: string[];
      ship: Array<{ label: string; word: string; done: boolean }>;
    }
    const captured = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/hud/old-mod-reads-hud3.json'), 'utf8'),
    ) as { inputs: Record<string, Record<string, unknown>>; readings: Record<string, OldReading> };
    const names = Object.keys(captured.inputs);
    expect(names).toEqual(expect.arrayContaining(['FAST_ORD_490', 'FULL_ORD_501', 'SHIPPED']));
    expect(Object.keys(captured.readings)).toEqual(names);
    for (const name of names) {
      const input = captured.inputs[name]!;
      const reading = captured.readings[name]!;
      expect(input.schema).toBe('paqad.hud/3');
      expect(parseSnapshot(JSON.stringify(input))).not.toBeNull();
      expect(reading.threw).toBeNull();
      expect(reading.parsed).toBe(true);
      expect(reading.headline.length).toBeGreaterThan(0);
      expect(reading.stages).toHaveLength(8);
      expect(reading.ship.map((step) => step.label)).toEqual([
        'Edit',
        'Commit',
        'Push',
        'PR',
        'CI',
        'Merge',
      ]);
      expect(reading.ship.every((step) => !step.word.startsWith('<'))).toBe(true);
    }
    const today = Object.keys(JSON.parse(JSON.stringify(FULL_ORD_501)) as object).filter(
      (key) => key !== 'proof' && key !== 'start_point',
    );
    expect(Object.keys(captured.inputs.FULL_ORD_501!)).toEqual(expect.arrayContaining(today));
  });

  it('tolerates odd fields without guessing', () => {
    const odd = parseSnapshot(
      JSON.stringify({
        schema: 'paqad.hud/3',
        scope: { qualified: true },
        headline: { text: 7, tone: 'shouting' },
        paused: [{}, 'x'],
        stages: [{ stage: 'planning' }, { state: 'complete' }, null],
        gates: [{ verdict: 'pass' }, { name: 'g' }],
        flags: [{ text: 'no id' }, { id: 'f' }],
        rules: 'yes',
        findings: { rules: { status: 'weird', total: 'n' }, near_copies: null },
        decisions: { pending: [{}], resolved: 'two' },
        last_block: 'RULE-1 stopped an edit.',
        ship: { commits: 'three', push: { state: 'pushed' }, pr: { status: 'open' }, ci: {} },
        verdict: { kind: 'maybe' },
      }),
    )!;
    expect(odd.session_id).toBe('');
    expect(odd.headline).toEqual({ text: '', tone: 'neutral' });
    expect(odd.change).toBeNull();
    expect(odd.paused).toEqual([
      { workflow: 'unknown', lane: null },
      { workflow: 'unknown', lane: null },
    ]);
    expect(odd.stages).toEqual([
      {
        stage: 'planning',
        state: 'missing',
        mandatory: false,
        started_at: null,
        ended_at: null,
        duration_unreliable: false,
        duration_ms: null,
        agent: null,
      },
    ]);
    expect(odd.gates).toEqual([{ name: 'g', verdict: 'pending', required: true, strength: null }]);
    expect(odd.claims).toEqual([]);
    expect(odd.bundle_files).toEqual([]);
    expect(odd.receipt).toBeNull();
    expect(odd.flags).toEqual([{ id: 'f', text: 'f' }]);
    expect(odd.rules).toEqual({ recorded: false, applicable: null, loaded_at: null });
    expect(odd.findings).toEqual({
      rules: { status: 'did not run', total: null, blocking: false },
      near_copies: { status: 'did not run', total: null, blocking: false },
    });
    expect(odd.decisions).toEqual({
      pending: [{ id: 'unknown', category: 'unknown', question: '' }],
      resolved: 0,
    });
    expect(odd.last_block).toEqual({ text: 'RULE-1 stopped an edit.' });
    expect(odd.ship).toEqual({
      commits: 0,
      commit_decision: null,
      merge_commit: null,
      push: 'pushed',
      pr: 'open',
      ci: 'recorded',
      push_branch: null,
      pr_url: null,
      ci_detail: null,
      own: null,
      inherited: null,
      commit_list: [],
      inherited_count: 0,
      pr_number: null,
      pr_state: null,
      pr_head: null,
      pr_title: null,
      pr_files: null,
      pr_additions: null,
      pr_deletions: null,
      files_changed: null,
      ci_read_at: null,
      all_green: false,
      merged: false,
    });
    expect(odd.verdict).toBeNull();
  });

  it('AC-27: reads every Part I field, and leaves out each one that is absent or odd', () => {
    const full = parse(
      snapshot({
        ...FULL_ORD_501,
        gates_expected: ['change-completeness', 7, 'spec-review'],
        delivery_plan: {
          commit: true,
          push: false,
          pr: false,
          ci: false,
          merge: false,
          reason: 'No push for this change',
        },
        plan: { steps: 5, done: 3 },
        claims: [
          { kind: 'acceptance', id: 'AC-1', label: 'binds', test_id: 't.test.ts', verdict: 'pass' },
        ],
        ship: {
          ...(FULL_ORD_501.ship as Record<string, unknown>),
          pr_title: 'Add CSV export',
          pr_files: 14,
          pr_additions: 412,
          pr_deletions: 87,
          files_changed: 14,
        },
        timeline: [
          {
            at: '2026-10-18T08:01:00.000Z',
            kind: 'stage_start',
            stage: 'planning',
            note: null,
            agent: 'paqad:paqad-planning',
            own_agent: true,
          },
          {
            at: '2026-10-18T08:02:41.000Z',
            kind: 'stage_end',
            stage: 'planning',
            note: null,
            duration_ms: 101000,
            agent: null,
            own_agent: 'yes',
          },
          {
            at: '2026-10-18T08:30:00.000Z',
            kind: 'commit',
            stage: null,
            note: null,
            sha: 'a1c9e2f',
            subject: 'one',
            count: 'two',
          },
        ],
        cost: costRecord({ live: true }),
        stages: [
          {
            stage: 'planning',
            state: 'complete',
            mandatory: true,
            started_at: null,
            ended_at: null,
            duration_ms: 101000,
            agent: 'paqad:paqad-planning',
            duration_unreliable: false,
          },
        ],
      }),
    );
    expect(full.gates_expected).toEqual(['change-completeness', 'spec-review']);
    expect(full.delivery_plan).toEqual({
      commit: true,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: 'No push for this change',
    });
    expect(full.plan).toEqual({ steps: 5, done: 3 });
    expect(full.claims[0]).toMatchObject({ kind: 'acceptance', id: 'AC-1', verdict: 'pass' });
    expect(full.ship).toMatchObject({
      pr_title: 'Add CSV export',
      pr_files: 14,
      pr_additions: 412,
      pr_deletions: 87,
      files_changed: 14,
    });
    expect(full.timeline).toEqual([
      {
        at: '2026-10-18T08:01:00.000Z',
        kind: 'stage_start',
        stage: 'planning',
        note: null,
        agent: 'paqad:paqad-planning',
        own_agent: true,
      },
      {
        at: '2026-10-18T08:02:41.000Z',
        kind: 'stage_end',
        stage: 'planning',
        note: null,
        duration_ms: 101000,
      },
      {
        at: '2026-10-18T08:30:00.000Z',
        kind: 'commit',
        stage: null,
        note: null,
        sha: 'a1c9e2f',
        subject: 'one',
      },
    ]);
    expect(full.cost?.live).toBe(true);
    expect(full.stages[0]).toMatchObject({ duration_ms: 101000, agent: 'paqad:paqad-planning' });

    const bare = parse(
      snapshot({
        ...FULL_ORD_501,
        delivery_plan: { commit: true, push: 'yes', pr: true, ci: true, merge: true },
        plan: { steps: 0, done: 0 },
        cost: costRecord({ live: 'yes' }),
      }),
    );
    expect(bare.gates_expected).toEqual([]);
    expect(bare.delivery_plan).toBeNull();
    expect(bare.plan).toBeNull();
    expect(bare.cost?.live).toBe(false);
    expect(bare.claims.every((claim) => claim.id === null)).toBe(true);
    expect(parse(snapshot({ plan: 'five', delivery_plan: 'all' }))).toMatchObject({
      plan: null,
      delivery_plan: null,
    });
  });

  it('keeps the delivery plan and the gate list on an unqualified snapshot, and drops the plan', () => {
    const idle = parse(
      snapshot({
        ...FULL_ORD_501,
        scope: { qualified: false, reason: 'no-change' },
        gates_expected: ['spec-review'],
        delivery_plan: {
          commit: true,
          push: true,
          pr: true,
          ci: false,
          merge: true,
          reason: 'No CI',
        },
        plan: { steps: 5, done: 1 },
      }),
    );
    expect(idle.active).toBe(false);
    expect(idle.gates_expected).toEqual(['spec-review']);
    expect(idle.delivery_plan?.reason).toBe('No CI');
    expect(idle.plan).toBeNull();
  });

  it('reads a rule stop by its text or reason, and names one with neither', () => {
    const at = (last_block: unknown) => parse(snapshot({ last_block })).last_block;
    expect(at({ text: 'A' })).toEqual({ text: 'A' });
    expect(at({ reason: 'B' })).toEqual({ text: 'B' });
    expect(at({})).toEqual({ text: 'A rule stopped an edit.' });
    expect(at(null)).toBeNull();
  });

  it('reads the structured rule-stop record and names the rule and file', () => {
    const at = (last_block: unknown) => parse(snapshot({ last_block })).last_block;
    const record = {
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      tool_use_id: 'tu_1',
      managed: false,
      at: '2026-10-20T10:00:00.000Z',
      diff: '+ // hi',
      token: 'abc',
      used: false,
      session: 's',
    };
    expect(at(record)).toEqual({
      text: 'RL-1 stopped an edit to src/x.ts.',
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      tool_use_id: 'tu_1',
      managed: false,
      at: '2026-10-20T10:00:00.000Z',
      token: 'abc',
      used: false,
    });
    expect(bandState(parse({ ...FULL_ORD_501, last_block: record }))).toBe('Safe to merge');
    expect(bandState(parse({ ...FULL_ORD_501, last_block: { ...record, used: true } }))).toBe(
      'Safe to merge',
    );
  });

  it('fills a verdict word from its kind when the word is missing', () => {
    const verdict = parse(snapshot({ verdict: { kind: 'fail' } })).verdict;
    expect(verdict).toEqual({ word: 'Needs your attention', kind: 'fail', reasons: [] });
  });
});

describe('paths match the snapshot writer (src/hud/files.ts)', () => {
  it.each(['ses-1', 'a/b c', '..hidden', ''])('session %j', (id) => {
    const posix = (path: string) => path.replace(/\\/g, '/');
    expect(snapshotPath('/repo', id)).toBe(posix(hudSnapshotPath('/repo', id)));
    expect(receiptPath('/repo', id)).toBe(posix(hudReceiptPath('/repo', id)));
  });

  it('keeps a root separator once', () => {
    expect(joinPath('/', '.paqad/x')).toBe('/.paqad/x');
    expect(joinPath('C:\\', '.paqad/x')).toBe('C:\\.paqad/x');
    expect(safeSessionId('')).toBe('unknown');
  });
});

describe('the eight band states', () => {
  it('has exactly eight, each reached by its fixture', () => {
    expect(BAND_STATES).toHaveLength(8);
    for (const state of BAND_STATES) {
      expect(bandState(parse(STATE_FIXTURES[state]))).toBe(state);
    }
  });

  it('reads Ready with no snapshot, and with no workflow routed', () => {
    expect(bandState(null)).toBe('Ready');
    expect(bandState(parse(snapshot({ route: 'no-workflow' })))).toBe('Ready');
  });

  it('reads Working while a change goes on with no verdict and nothing running', () => {
    const between = parse({ ...FULL_ORD_501, verdict: null, flags: [] });
    expect(bandState(between)).toBe('Working');
  });

  it('needs you while a question or a permission waits, whatever the snapshot says', () => {
    const question = { ...IDLE_LIVE, turnId: 't', waitingOn: 'question' as const };
    const permission = { ...IDLE_LIVE, turnId: 't', waitingOn: 'permission' as const };
    expect(bandState(parse(FULL_ORD_501), question)).toBe('Needs you');
    expect(bandState(parse(FAST_ORD_490), permission)).toBe('Needs you');
  });

  it('a verdict written before the current turn started does not lead', () => {
    const at = Date.parse('2026-10-18T09:00:00.000Z');
    const judged = parse({
      ...FULL_ORD_501,
      verdict: {
        kind: 'fail',
        word: 'Needs your attention',
        reasons: [],
        written_at: new Date(at).toISOString(),
      },
    });
    expect(bandState(judged)).toBe('Needs your attention');
    expect(bandState(judged, { ...IDLE_LIVE, turnId: 't', turnStartedAt: at + 1000 })).toBe(
      'Working',
    );
    expect(bandState(judged, { ...IDLE_LIVE, turnId: 't', turnStartedAt: at - 1000 })).toBe(
      'Needs your attention',
    );
  });

  it('puts a waiting decision ahead of everything else', () => {
    const both = parse({
      ...FULL_ORD_501,
      decisions: { pending: [{ id: 'D-1', category: 'c', question: 'q' }], resolved: 0 },
      last_block: { text: 'stopped' },
    });
    expect(bandState(both)).toBe('Needs you');
  });

  it('turns amber whenever a flag is open, even at Safe to merge (decision 17)', () => {
    expect(bandTone('Safe to merge', 1)).toBe('warn');
    expect(bandTone('Working', 2)).toBe('warn');
    expect(bandTone('Ready', 1)).toBe('warn');
    expect(bandTone('Safe to merge', 0)).toBe('good');
    expect(bandTone('Needs your attention', 1)).toBe('bad');
    expect(bandTone('Needs you', 1)).toBe('needs-you');
    expect(buildBandView(parse(FULL_ORD_501), NOW)).toMatchObject({
      state: 'Safe to merge',
      tone: 'warn',
      flags: 1,
    });
  });
});

describe('the Stage instrument', () => {
  it('draws 8 segments, Intake to Deliver', () => {
    expect(STAGE_ORDER.map(([, label]) => label)).toEqual([
      'Intake',
      'Planning',
      'Spec',
      'Build',
      'Review',
      'Checks',
      'Docs',
      'Deliver',
    ]);
    expect(stageSegments(parse(GRADUATED_ORD_482))).toHaveLength(8);
  });

  it('reads Spec as not required on the fast lane, and the build running', () => {
    const segments = stageSegments(parse(FAST_ORD_490));
    expect(segments.map((s) => s.state)).toEqual([
      NOT_YET,
      'done',
      'not required',
      'running',
      'not required',
      NOT_YET,
      'not required',
      NOT_YET,
    ]);
    const older = parse({ ...FAST_ORD_490, lane_stages: undefined });
    expect(stageSegments(older).map((s) => s.state)[4]).toBe(NOT_YET);
  });

  it('reads every segment "not yet" with no change in progress or no snapshot', () => {
    expect(stageSegments(null).every((s) => s.state === NOT_YET)).toBe(true);
    expect(stageSegments(parse(snapshot())).every((s) => s.state === NOT_YET)).toBe(true);
  });

  it('maps each recorded state to its segment', () => {
    const snap = parse(
      snapshot({
        active: true,
        lane: 'full',
        stages: stages({
          ticket_intake: 'skipped',
          planning: 'redone',
          specification: 'inconclusive',
          development: 'failed',
          review: 'not-applicable',
          checks: 'complete',
        }),
      }),
    );
    expect(stageSegments(snap).map((s) => s.state)).toEqual([
      'not required',
      'done',
      'marked',
      'failed',
      'not required',
      'marked',
      NOT_YET,
      NOT_YET,
    ]);
  });

  it('keeps the live clock to the running stage', () => {
    const segments = stageSegments(parse(FAST_ORD_490));
    expect(liveClock(segments, NOW)).toBe('2m 00s');
    expect(liveClock(stageSegments(parse(GRADUATED_ORD_482)), NOW)).toBeNull();
    const noStart = segments.map((s) => (s.state === 'running' ? { ...s, started_at: 'x' } : s));
    expect(liveClock(noStart, NOW)).toBeNull();
  });

  it.each([
    [0, '0s'],
    [-5, '0s'],
    [45_000, '45s'],
    [185_000, '3m 05s'],
    [3_720_000, '1h 02m'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe('the band never shows a stage done that the receipt does not', () => {
  const STATES = [
    'complete',
    'redone',
    'running',
    'failed',
    'inconclusive',
    'skipped',
    'not-applicable',
    'missing',
  ];
  const IDS = STAGE_ORDER.map(([stage]) => stage);

  function folded(stage: string, state: string, unreliable: boolean): FoldedStage {
    return {
      stage,
      state: state as FoldedStage['state'],
      started_at: state === 'missing' ? null : '2026-10-18T08:30:00.000Z',
      ended_at: state === 'complete' || state === 'redone' ? '2026-10-18T08:40:00.000Z' : null,
      duration_ms: null,
      duration_unreliable: unreliable,
      evidence_source: 'live-mark',
      artifact_digest: null,
    } as FoldedStage;
  }

  for (const checksVerified of [true, false]) {
    for (const unreliable of [true, false]) {
      it(`agrees for every state (checks verified: ${checksVerified}, unreliable: ${unreliable})`, () => {
        for (const state of STATES) {
          const stagesFolded = IDS.map((id) => folded(id, state, unreliable));
          const fold = { stages: stagesFolded } as unknown as FoldedChange;
          const receipt = formatStageEvidenceReceipt(fold, checksVerified);
          const snap = parse(
            snapshot({
              active: true,
              lane: 'full',
              stages: stagesFolded.map((s) => ({ ...s, mandatory: true })),
              gates: checksVerified ? [{ name: 'code-tests-lint', verdict: 'pass' }] : [],
            }),
          );
          for (const segment of stageSegments(snap)) {
            if (segment.state !== 'done') continue;
            const line = receipt
              .split('\n')
              .find((l) => l.includes(` ${segment.stage.replace(/_/g, ' ')} — `));
            expect(line, `${segment.stage} ${state}`).toMatch(/— done/);
          }
        }
      });
    }
  }
});

describe('pills and live checks', () => {
  it('names the flag count and keeps cost at "not yet"', () => {
    expect(flagPill(0)).toBeNull();
    expect(flagPill(1)).toBe('1 flag');
    expect(flagPill(3)).toBe('3 flags');
    expect(costPill(null)).toBe('cost: not yet');
    expect(buildBandView(null, NOW)).toMatchObject({
      state: 'Ready',
      headline: 'Not yet. paqad has no record for this session.',
      cost: 'cost: not yet',
      clock: null,
    });
  });

  it('is live only while a stage of the change runs', () => {
    expect(isLive(parse(FAST_ORD_490))).toBe(true);
    expect(isLive(parse(GRADUATED_ORD_482))).toBe(false);
    expect(isLive(null)).toBe(false);
  });

  it.each([
    [{ type: 'paqad:paqad-planning', status: 'running' }, true],
    [{ type: 'paqad-review', status: 'pending' }, true],
    [{ type: 'paqad:paqad-checks', status: 'waiting' }, true],
    [{ type: 'paqad:paqad-checks', status: 'completed' }, false],
    [{ type: 'general-purpose', status: 'running' }, false],
    [{ status: 'running' }, false],
  ])('stage agent %o -> %s', (agent, yes) => {
    expect(isStageAgent(agent)).toBe(yes);
  });

  it.each([
    ['Edit', {}, true],
    ['Write', {}, true],
    ['NotebookEdit', {}, true],
    ['Agent', {}, true],
    ['Task', {}, true],
    ['Bash', { command: 'pnpm exec paqad-ai stage end planning' }, true],
    ['Bash', { command: 'ls' }, false],
    ['Bash', {}, false],
    ['Read', {}, false],
  ])('a finished %s call %o refreshes: %s', (tool, input, yes) => {
    expect(isRefreshTool(tool, input)).toBe(yes);
  });
});

describe('the fixtures match the snapshot paqad writes', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('carries the same fields, and the mod reads the real file', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-mod-model-'));
    roots.push(root);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
    const S = 'ses-mod';
    openFeatureChange(root, S, {
      adapter: 'claude-code',
      title: 'ORD-490 copy fix',
      issue: 'ORD-490',
      lane: 'fast',
    });
    persistLedgerSessionId(root, S);
    writeWorkflowState(root, S, {
      active: { workflow: 'feature-development', lane: 'fast', reason: 'a copy fix' },
      paused: [],
    });
    startStage(root, 'planning', { sessionId: S, adapter: 'claude-code' });
    endStage(root, 'planning', { artifactPaths: [] }, { sessionId: S, adapter: 'claude-code' });
    startStage(root, 'development', { sessionId: S, adapter: 'claude-code' });
    writeHudSnapshot(root, S);

    const text = readFileSync(snapshotPath(root, S), 'utf8');
    const real = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(FULL_ORD_501).sort()).toEqual(Object.keys(real).sort());
    const stageKeys = Object.keys((real.stages as Array<Record<string, unknown>>)[0]!).sort();
    expect(Object.keys(stages({})[0]!).sort()).toEqual(stageKeys);

    const parsed = parseSnapshot(text)!;
    expect(parsed.active).toBe(true);
    expect(parsed.lane).toBe('fast');
    expect(bandState(parsed)).toBe('Working');
    expect(stageSegments(parsed).find((s) => s.stage === 'development')?.state).toBe('running');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DoneLadder } from '@/hud/done-ladder.js';
import {
  buildTrackRecords,
  computeHudFlags,
  computeHudHeadline,
  type HudHeadlineInput,
  type HudStage,
} from '@/hud/snapshot.js';

function stage(name: string, state: HudStage['state'], mandatory = true): HudStage {
  return {
    stage: name,
    state,
    mandatory,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    duration_unreliable: false,
    agent: null,
    proof_file: null,
  } as HudStage;
}

function headline(input: Partial<HudHeadlineInput>): ReturnType<typeof computeHudHeadline> {
  return computeHudHeadline({
    route: null,
    active: true,
    stages: [],
    pendingDecisions: 0,
    verdict: null,
    flags: [],
    paused: 0,
    ...input,
  });
}

const PR = `PR #${702}`;

describe('computeHudHeadline', () => {
  const verdict = (
    kind: 'pass' | 'fail' | 'inconclusive',
    over: Record<string, unknown> = {},
  ): HudHeadlineInput['verdict'] =>
    ({
      schema: 'paqad.hud-verdict/1',
      session_id: 's',
      change: 'c',
      word: kind,
      kind,
      passed: kind === 'pass',
      reasons: [],
      written_at: '2026-10-18T09:00:00.000Z',
      ...over,
    }) as never;
  const ladder = (over: Partial<DoneLadder>): DoneLadder => ({
    rung: 'done',
    ci: null,
    ci_failed: false,
    uncommitted: false,
    ...over,
  });
  const pr = (over: Record<string, unknown> = {}) =>
    ({
      pr: { number: 702 },
      pr_state: 'open',
      ci: null,
      push: null,
      commit_decision: null,
      ...over,
    }) as never;
  const workGate = (name: string, owner: 'work' | 'paqad-record' = 'work') => ({
    name,
    required: true,
    strength: 'deterministic' as const,
    verdict: 'fail' as const,
    owner,
  });

  it('row 6: counts several waiting decisions in the plural', () => {
    expect(headline({ pendingDecisions: 2 })).toMatchObject({
      row: 6,
      text: '2 decisions are waiting for you',
      tone: 'needs-you',
    });
    expect(headline({ pendingDecisions: 1 }).text).toBe('1 decision is waiting for you');
  });

  it('row 5: names the chief architect once the table has ruled with open conflicts', () => {
    expect(
      headline({
        pendingDecisions: 2,
        decisions: [{ category: 'spec.expert_conflict' }, { category: 'spec.expert_conflict' }],
        table: { chief: { state: 'done', verdict: 'needs answers' }, seats: [] } as never,
      }),
    ).toMatchObject({ row: 5, text: 'The chief architect has 2 questions for you' });
  });

  it('row 15: names a running stage with its clock start, and an unknown one as written', () => {
    expect(
      headline({
        stages: [{ ...stage('development', 'running'), started_at: 'T' }],
        plan: { steps: 4, done: 1 },
      }),
    ).toMatchObject({ row: 15, text: '1 of 4 plan steps built', tone: 'working', clock_from: 'T' });
    expect(headline({ stages: [stage('custom-step', 'running')] }).text).toBe(
      'custom-step is running',
    );
  });

  it('rows 18 to 20: names the next stage, then waits once every stage is recorded', () => {
    expect(headline({ stages: [stage('planning', 'missing')] })).toMatchObject({
      row: 19,
      text: 'Next: Plan',
      tone: 'neutral',
    });
    expect(
      headline({ stages: [stage('planning', 'complete'), stage('specification', 'missing')] }),
    ).toMatchObject({ row: 18, text: 'Plan done. Next: Spec' });
    expect(headline({ stages: [stage('planning', 'complete')] })).toMatchObject({
      row: 20,
      text: 'Every stage is recorded. Waiting for the verdict.',
    });
  });

  it('row 16: Done in the success colour with a dim not committed note, never amber', () => {
    expect(headline({ verdict: verdict('pass'), ladder: ladder({ uncommitted: true }) })).toEqual({
      row: 16,
      text: 'Done',
      word: 'Done',
      tone: 'good',
      rung: 'done',
      note: 'not committed',
    });
    expect(
      headline({
        verdict: verdict('pass'),
        ladder: ladder({ uncommitted: true }),
        ship: pr({ pr: null, pr_state: null, commit_decision: 'decline' }),
      }).note,
    ).toBe('left uncommitted, as you asked');
  });

  it('row 16: Committed once the edit is committed', () => {
    expect(
      headline({ verdict: verdict('pass'), ladder: ladder({ rung: 'committed' }) }),
    ).toMatchObject({ row: 16, text: 'Committed', tone: 'good', rung: 'committed' });
  });

  it('row 17: PR open, saying CI result unknown when CI cannot be read', () => {
    const open = { verdict: verdict('pass'), ship: pr() };
    expect(headline({ ...open, ladder: ladder({ rung: 'pr-open', ci: 'unknown' }) })).toMatchObject(
      {
        row: 17,
        text: `${PR} is open. CI result unknown`,
        tone: 'good',
        rung: 'pr-open',
      },
    );
  });

  it('row 8: Safe to merge only on a green CI result', () => {
    expect(
      headline({
        verdict: verdict('pass'),
        ship: pr({ ci: { state: 'pass' } }),
        ladder: ladder({ rung: 'safe-to-merge', ci: 'pass' }),
      }),
    ).toMatchObject({
      row: 8,
      text: `Safe to merge: ${PR} is ready for your merge`,
      tone: 'good',
    });
  });

  it('row 7: Merged, even with no fresh verdict', () => {
    expect(
      headline({ ship: pr({ pr_state: 'merged' }), ladder: ladder({ rung: 'merged' }) }),
    ).toMatchObject({ row: 7, text: `${PR} is merged`, tone: 'good', rung: 'merged' });
  });

  it('row 14: watches CI while it runs on the open PR', () => {
    expect(
      headline({
        verdict: verdict('pass'),
        ship: pr({ ci: { state: 'pending' } }),
        ladder: ladder({ rung: 'pr-open', ci: 'pending' }),
      }),
    ).toMatchObject({ row: 14, text: `Watching CI on ${PR}`, tone: 'working' });
  });

  it('AC-15 row 10: CI turning red reports the failure, never Safe to merge', () => {
    expect(
      headline({
        verdict: verdict('pass'),
        ship: pr({ ci: { state: 'fail' } }),
        ladder: ladder({ rung: 'committed', ci: 'fail', ci_failed: true }),
      }),
    ).toMatchObject({ row: 10, text: `CI failed on ${PR}`, tone: 'bad' });
  });

  it('rows 9 and 11: a closed PR and a failed push', () => {
    expect(headline({ ship: pr({ pr_state: 'closed' }) })).toMatchObject({ row: 9, tone: 'warn' });
    expect(headline({ ship: pr({ pr_state: null, push: { state: 'failed' } }) })).toMatchObject({
      row: 11,
      text: 'The push failed',
    });
  });

  it('row 12: names only failing work gates, keyed on work_kind', () => {
    expect(
      headline({
        verdict: verdict('fail', { work_kind: 'fail' }),
        gates: [
          workGate('code-tests-lint'),
          workGate('stage-evidence', 'paqad-record'),
          workGate('duplication'),
        ],
        gatesExpected: ['code-tests-lint', 'duplication'],
      }),
    ).toMatchObject({ row: 12, text: 'Tests, types or lint failed and 1 more', tone: 'bad' });
  });

  it('AC-5, AC-33: a paqad-only gap shows Done plus one neutral line, never a fix instruction', () => {
    const head = headline({
      verdict: verdict('fail', { work_kind: 'pass' }),
      gates: [workGate('stage-evidence', 'paqad-record')],
      ladder: ladder({ uncommitted: true }),
      recordGaps: [
        'paqad could not record every stage of this change',
        'paqad could not record the lane for this change',
      ],
    });
    expect(head).toMatchObject({
      row: 16,
      text: 'Done',
      tone: 'good',
      gap: 'paqad could not record every stage of this change and 1 more',
    });
    expect(JSON.stringify(head)).not.toContain('Fix it');
  });

  it('puts a gate that could not prove in the neutral line beside the rung, never a flag', () => {
    const head = headline({
      verdict: verdict('pass', { work_kind: 'pass' }),
      ladder: ladder({}),
      recordGaps: ['paqad could not record the lane for this change'],
      unproven: ['paqad could not prove the spec was reviewed'],
    });
    expect(head).toMatchObject({
      row: 16,
      text: 'Done',
      gap: 'paqad could not record the lane for this change and 1 more',
    });
    expect(
      headline({
        verdict: verdict('pass', { work_kind: 'pass' }),
        ladder: ladder({}),
        unproven: ['paqad could not prove the spec was reviewed'],
      }).gap,
    ).toBe('paqad could not prove the spec was reviewed');
  });

  it('a red checks run after the verdict reads red, never Done or stale', () => {
    expect(headline({ verdict: verdict('pass'), checks: 'red' })).toMatchObject({
      row: 12,
      text: 'Tests, types or lint failed',
    });
  });

  it('AC-20 row 13: an inconclusive work verdict leads with its first work reason', () => {
    expect(
      headline({
        verdict: verdict('inconclusive', {
          work_kind: 'inconclusive',
          reasons: ['rules-loaded: missing', 'spec-review: no spec'],
          work_reasons: ['spec-review: no spec'],
        }),
      }),
    ).toMatchObject({ row: 13, text: 'Inconclusive: spec-review: no spec', tone: 'warn' });
  });

  it('falls back to the overall kind only when work_kind is absent', () => {
    expect(
      headline({ verdict: verdict('fail'), gates: [workGate('code-tests-lint')] }),
    ).toMatchObject({ row: 12 });
    expect(headline({ verdict: verdict('pass') })).toMatchObject({
      row: 13,
      text: 'Inconclusive: no checks result for this change',
    });
  });

  it('skips a verdict from an earlier turn only while a newer turn runs a stage', () => {
    const failed = {
      verdict: verdict('fail', { work_kind: 'fail' }),
      gates: [workGate('code-tests-lint')],
      verdictEarlier: true,
    };
    expect(headline({ ...failed, stages: [stage('development', 'running')] }).row).toBe(15);
    expect(headline({ ...failed, stages: [stage('development', 'complete')] }).row).toBe(12);
  });

  it('a running stage leads over any verdict while its stage agent is alive', () => {
    const failed = { verdict: verdict('fail', { work_kind: 'fail' }), stageAgentLive: true };
    const building = [stage('planning', 'complete'), stage('development', 'running')];
    expect(
      headline({ ...failed, stages: building, plan: { steps: 15, done: 12 } as never }),
    ).toMatchObject({ row: 15, text: '12 of 15 plan steps built', tone: 'working' });
    expect(headline({ ...failed, stages: building, verdict: verdict('inconclusive') }).row).toBe(
      15,
    );
    expect(
      headline({ ...failed, stages: building, verdict: verdict('pass'), checks: 'red' }).row,
    ).toBe(15);
    expect(headline({ ...failed, stages: [stage('development', 'complete')] }).row).not.toBe(15);
  });

  it('a stage left running with no live agent still shows its verdict', () => {
    const head = headline({
      verdict: verdict('fail', { work_kind: 'fail' }),
      gates: [workGate('code-tests-lint')],
      stages: [stage('development', 'running')],
      stageAgentLive: false,
    });
    expect(head).toMatchObject({ row: 12, text: 'Tests, types or lint failed', tone: 'bad' });
  });

  it('a fail with no failing gate to name reads Inconclusive, never the bare verdict words', () => {
    const notJudged = { ...workGate('traceability'), verdict: 'not-judged' as const };
    const cases = [
      headline({ verdict: verdict('fail', { work_kind: 'fail' }) }),
      headline({ verdict: verdict('fail', { work_kind: 'fail' }), gates: [notJudged] }),
      headline({
        verdict: verdict('fail', { work_kind: 'fail' }),
        gates: [workGate('stage-evidence', 'paqad-record')],
      }),
    ];
    for (const head of cases) {
      expect(head).toMatchObject({ row: 13, text: 'Inconclusive', tone: 'warn' });
      expect(head.text).not.toContain('Needs your attention');
    }
    expect(
      headline({
        verdict: verdict('fail', {
          work_kind: 'fail',
          work_reasons: ['traceability: AC-3 has no proving test'],
        }),
      }),
    ).toMatchObject({ row: 13, text: 'Inconclusive: traceability: AC-3 has no proving test' });
  });

  it('reports an idle session as ready, and a routed one as working', () => {
    expect(headline({ active: false })).toEqual({
      text: 'Ready. No change in progress.',
      tone: 'neutral',
    });
    expect(headline({ active: false, route: 'no-workflow' }).text).toBe(
      'Ready. No change in progress.',
    );
  });
});

describe('computeHudFlags', () => {
  it('raises no flag for a gate that could not prove, of either owner', () => {
    const unproven = (name: string, owner: 'work' | 'paqad-record') => ({
      name,
      required: true,
      strength: 'deterministic' as const,
      verdict: 'inconclusive' as const,
      owner,
    });
    expect(
      computeHudFlags({
        stages: [],
        gates: [unproven('spec-review', 'work'), unproven('stage-evidence', 'paqad-record')],
        rulesRecorded: true,
        tableSkipped: false,
        isolationStatus: 'not-required',
        isolatedStages: 0,
      }),
    ).toEqual([]);
  });

  const flagsFor = (rules: { total: number; blocking: boolean }) =>
    computeHudFlags({
      stages: [stage('development', 'missing')],
      gates: [],
      rulesRecorded: false,
      tableSkipped: false,
      isolationStatus: 'not-required',
      isolatedStages: 0,
      findings: { rules, near_copies: { total: 3 } } as never,
    });

  it('counts one blocking rule finding and several near copies', () => {
    expect(flagsFor({ total: 1, blocking: true }).map((flag) => flag.text)).toEqual([
      '1 rule finding is open.',
      '3 near-copies of existing code are open.',
    ]);
  });

  it('raises no rule flag for findings that block nothing', () => {
    expect(flagsFor({ total: 18, blocking: false }).map((flag) => flag.id)).toEqual([
      'near-copies',
    ]);
  });
});

describe('buildTrackRecords', () => {
  it('returns nothing for no roles or no other changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-track-'));
    try {
      expect(buildTrackRecords(root, 'x', []).size).toBe(0);
      expect(buildTrackRecords(root, 'x', ['qa-engineer']).size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('AC-15: flags fire only once their stage has ended', () => {
  const base = {
    gates: [],
    rulesRecorded: false,
    tableSkipped: false,
    isolationStatus: 'expected',
    isolatedStages: 0,
  };
  const ids = (stages: HudStage[], over: Record<string, unknown> = {}) =>
    computeHudFlags({ ...base, stages, ...over }).map((flag) => flag.id);
  const ran = (name: string, state: HudStage['state']): HudStage => ({
    ...stage(name, state),
    started_at: '2026-10-18T08:00:00.000Z',
    ended_at: state === 'running' ? null : '2026-10-18T08:10:00.000Z',
  });

  it('no isolation flag while the first stage agent runs; it fires once a stage ended without one', () => {
    expect(ids([ran('planning', 'running')])).not.toContain('isolation-missing');
    expect(ids([ran('planning', 'complete'), stage('development', 'missing')])).toContain(
      'isolation-missing',
    );
    expect(ids([ran('planning', 'complete')], { isolatedStages: 1 })).not.toContain(
      'isolation-missing',
    );
  });

  it('the rules flag waits for Build to end, and an inferred Build end never raises it', () => {
    expect(ids([ran('development', 'running')])).not.toContain('rules-not-loaded');
    expect(ids([stage('development', 'complete')])).not.toContain('rules-not-loaded');
    expect(ids([ran('development', 'complete')])).toContain('rules-not-loaded');
    expect(ids([ran('development', 'redone')])).toContain('rules-not-loaded');
    expect(ids([ran('development', 'complete')], { rulesRecorded: true })).not.toContain(
      'rules-not-loaded',
    );
  });
});

describe('FR-20: a started stage-agent record counts as the stage running in its own agent', () => {
  it('no isolation flag between a stage end and its agent stop', () => {
    const ended: HudStage = {
      ...stage('planning', 'complete'),
      started_at: '2026-10-18T08:00:00.000Z',
      ended_at: '2026-10-18T08:10:00.000Z',
    };
    const flags = (stageAgentsSeen: number) =>
      computeHudFlags({
        stages: [ended],
        gates: [],
        rulesRecorded: true,
        tableSkipped: false,
        isolationStatus: 'expected',
        isolatedStages: 0,
        stageAgentsSeen,
      }).map((flag) => flag.id);
    expect(flags(1)).not.toContain('isolation-missing');
    expect(flags(0)).toContain('isolation-missing');
  });
});

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
    expect(
      headline({
        verdict: verdict('pass'),
        checks: 'green',
        ladder: ladder({ uncommitted: true }),
      }),
    ).toEqual({
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
        checks: 'green',
        ladder: ladder({ uncommitted: true }),
        ship: pr({ pr: null, pr_state: null, commit_decision: 'decline' }),
      }).note,
    ).toBe('left uncommitted, as you asked');
  });

  it('row 16: a committed change reads Done, and keeps its rung for the receipt', () => {
    expect(
      headline({
        verdict: verdict('pass'),
        checks: 'green',
        ladder: ladder({ rung: 'committed' }),
      }),
    ).toMatchObject({ row: 16, text: 'Done', word: 'Done', tone: 'good', rung: 'committed' });
  });

  it('row 17 folds into Done: an open PR reads Done, whatever CI could be read', () => {
    const open = { verdict: verdict('pass'), checks: 'green' as const, ship: pr() };
    expect(headline({ ...open, ladder: ladder({ rung: 'pr-open', ci: 'unknown' }) })).toMatchObject(
      { row: 16, text: 'Done', tone: 'good', rung: 'pr-open' },
    );
  });

  it('row 8 is gone: a green CI on the open PR never says Safe to merge', () => {
    const green = headline({
      verdict: verdict('pass'),
      checks: 'green',
      ship: pr({ ci: { state: 'pass' } }),
      ladder: ladder({ rung: 'pr-open', ci: 'pass' }),
    });
    expect(green.row).not.toBe(8);
    expect(green.tone).toBe('good');
    expect(green.text).not.toMatch(/merge/i);
  });

  it('row 7 is gone: a merged PR keeps the rung the work earned', () => {
    const merged = headline({
      verdict: verdict('pass'),
      checks: 'green',
      ship: pr({ pr_state: 'merged' }),
      ladder: ladder({ rung: 'committed' }),
    });
    expect(merged).toMatchObject({ row: 16, tone: 'good' });
    expect(merged.text).not.toMatch(/merge/i);
  });

  it('row 14: once the work is done, CI pending on the open PR reads Coding Done: Watching CI', () => {
    expect(
      headline({
        verdict: verdict('pass'),
        checks: 'green',
        ship: pr({ ci: { state: 'pending' } }),
        ladder: ladder({ rung: 'pr-open', ci: 'pending' }),
      }),
    ).toMatchObject({ row: 14, text: 'Coding Done: Watching CI', tone: 'good', rung: 'pr-open' });
    expect(
      headline({ verdict: verdict('pass'), ship: pr({ ci: { state: 'pending' } }) }).text,
    ).not.toBe('Coding Done: Watching CI');
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
      checks: 'green',
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
      checks: 'green',
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
        checks: 'green',
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

  describe('Done means the paqad work is done', () => {
    const finished = [
      stage('planning', 'complete'),
      stage('development', 'redone'),
      stage('checks', 'complete'),
      stage('delivery', 'missing', false),
    ];
    const done = (over: Partial<HudHeadlineInput> = {}) =>
      headline({
        stages: finished,
        verdict: verdict('pass', { work_kind: 'pass' }),
        checks: 'green',
        ladder: ladder({}),
        ...over,
      });

    it('AC-7: reads Done with no commits, commits, a push, an open PR with CI pending or passed', () => {
      const cases: Array<Partial<HudHeadlineInput>> = [
        { ladder: ladder({ uncommitted: true }), ship: pr({ pr: null, pr_state: null }) },
        { ladder: ladder({ rung: 'committed' }), ship: pr({ pr: null, pr_state: null }) },
        {
          ladder: ladder({ rung: 'committed' }),
          ship: pr({ pr: null, pr_state: null, push: { state: 'pushed' } }),
        },
        { ladder: ladder({ rung: 'pr-open', ci: 'pass' }), ship: pr({ ci: { state: 'pass' } }) },
      ];
      for (const over of cases) {
        expect(done(over)).toMatchObject({ row: 16, tone: 'good', text: 'Done', word: 'Done' });
      }
      expect(done(cases[0]).note).toBe('not committed');
    });

    it('AC-8: withholds Done when a stage is missing, checks are red, or no verdict is on record', () => {
      expect(done({ stages: [...finished, stage('documentation_sync', 'missing')] }).row).toBe(18);
      expect(done({ checks: 'red' })).toMatchObject({ row: 12, tone: 'bad' });
      expect(done({ checks: 'unknown' }).row).not.toBe(16);
      expect(done({ verdict: null })).toMatchObject({ row: 20 });
      expect(
        done({
          verdict: verdict('fail', { work_kind: 'fail' }),
          gates: [workGate('code-tests-lint')],
        }),
      ).toMatchObject({ row: 12, tone: 'bad' });
      expect(done({ stages: [...finished, stage('review', 'running')] }).row).toBe(15);
    });

    it('AC-27: a fast-lane gate that was never judged keeps Done and goes to the gap line', () => {
      const head = done({
        verdict: verdict('fail', {
          work_kind: 'fail',
          work_reasons: ['implementation-review: machine findings were not reviewed'],
        }),
        gates: [{ ...workGate('implementation-review'), verdict: 'not-judged' as const }],
      });
      expect(head).toMatchObject({
        row: 16,
        text: 'Done',
        tone: 'good',
        gap: 'paqad could not prove implementation-review: machine findings were not reviewed',
      });
    });

    it('an inconclusive verdict with every stage done reads Done plus the gap line', () => {
      const head = done({
        verdict: verdict('inconclusive', {
          work_kind: 'inconclusive',
          work_reasons: ['spec-review: no spec'],
        }),
      });
      expect(head).toMatchObject({ row: 16, text: 'Done', tone: 'good' });
      expect(head.gap).toBe('paqad could not prove spec-review: no spec');
    });

    it('row 13 stays while stages are incomplete under an inconclusive verdict', () => {
      expect(
        done({
          stages: [stage('planning', 'complete'), stage('development', 'missing')],
          verdict: verdict('inconclusive', { work_kind: 'inconclusive' }),
        }),
      ).toMatchObject({ row: 13, tone: 'warn' });
    });

    it('AC-9: CI failing on the open PR turns Done red, and a new head brings Done back', () => {
      const failed = done({
        ladder: ladder({ rung: 'committed', ci: 'fail', ci_failed: true }),
        ship: pr({ ci: { state: 'fail' } }),
      });
      expect(failed).toMatchObject({ row: 10, tone: 'bad', text: `CI failed on ${PR}` });
      expect(
        done({ ladder: ladder({ rung: 'pr-open' }), ship: pr({ ci: { state: 'pending' } }) }),
      ).toMatchObject({ row: 14, text: 'Coding Done: Watching CI' });
      expect(
        done({ ladder: ladder({ rung: 'pr-open' }), ship: pr({ ci: { state: 'pass' } }) }),
      ).toMatchObject({ row: 16, text: 'Done' });
    });

    it('a stage that ended unproven withholds Done and reads Inconclusive, not waiting', () => {
      expect(done({ stages: [...finished, stage('review', 'inconclusive')] })).toMatchObject({
        row: 13,
        tone: 'warn',
        text: 'Inconclusive',
      });
    });

    it('rows 9 and 11 stay ahead of Done', () => {
      expect(done({ ship: pr({ pr_state: 'closed' }) }).row).toBe(9);
      expect(done({ ship: pr({ pr: null, pr_state: null, push: { state: 'failed' } }) }).row).toBe(
        11,
      );
    });
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

import { describe, expect, it } from 'vitest';

import {
  SETTLE_WINDOW_MS,
  settleStart,
  settledChange,
  stripAltText,
  stripAlts,
  CARD_ROWS,
  CHECK_CEILING_MS,
  checkPending,
  signoffRecord,
  signoffView,
  stageStrip as stagesOf,
  CONTROLS_COLUMNS,
  TASK_LIST_SENTENCES,
  UNREADABLE,
  RECORD_MISSING,
  RECORD_MISSING_HINT,
  homeShortened,
  middleTruncated,
  recordMissingLine,
  bandIsLive,
  GETTING_READY,
  buildDesktopBand,
  buildDesktopLedger,
  cardRows,
  costWords,
  flagLabel,
  deliverySteps,
  deliveryStrip,
  desktopHeadline,
  headlineAlt,
  identityText,
  identityView,
  refusesTaskList,
  stageStrip,
  stageWord,
  stripOf,
  tableStrip,
  taskListSentence,
  UPDATE_PLAN_TOOL,
  WAITING_FOR_ANSWER,
  type DesktopBandInput,
} from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { LABEL_MIN_PX, stageBarPx } from '../../../../runtime/claude-plugin/mod/strip.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  NOW,
  OTHER_WORKFLOW,
  costRecord,
  fileText,
  ord482Table,
  ord501Table,
  snapshot,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadHudSnapshot } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

type Raw = Record<string, unknown>;

const parse = (raw: Raw): PaqadHudSnapshot => parseSnapshot(fileText(raw))!;

const SHIP0 = {
  commits: 0,
  commit_decision: null,
  merge_commit: null,
  push: null,
  pr: null,
  ci: null,
};

const PR = `PR #${702}`;

const PR_OPEN = {
  ...SHIP0,
  commits: 2,
  push: { state: 'pushed', branch: 'feat/x' },
  pr: { number: 702, url: 'https://example.test/pull/702' },
  pr_state: 'open',
};

const OPEN: Raw = {
  ...FULL_ORD_501,
  stages: stages({}),
  table: null,
  gates: [],
  flags: [],
  decisions: { pending: [], resolved: 0 },
  ship: SHIP0,
  verdict: null,
  delivery_plan: { commit: true, push: true, pr: true, ci: true, merge: true, reason: null },
};

const open = (over: Raw = {}) => parse(snapshot({ ...OPEN, ...over }));
const head = (over: Raw = {}) => desktopHeadline(open(over), NOW);

const SHOWN = { minimised: false, closed: false, hidden: false };

function band(over: Partial<DesktopBandInput> = {}) {
  return buildDesktopBand({
    snapshot: open(),
    unbound: false,
    unavailable: false,
    now: NOW,
    turnStartedAt: null,
    visibility: SHOWN,
    menuOpen: false,
    columns: 93,
    maxRows: 12,
    ...over,
  });
}

const conflict = { id: 'D-1', category: 'spec.expert_conflict', question: 'Email?' };
const other = { id: 'D-2', category: 'fix.proof_method', question: 'Prove it?' };

describe('AC-9, AC-29: the Desktop headline follows Part B, first match wins', () => {
  it('row 1: a session that should be bound and cannot read its record', () => {
    expect(band({ snapshot: null, unbound: true })).toEqual({
      kind: 'unreadable',
      reason: 'session-id',
      headline: UNREADABLE,
    });
    expect(band({ snapshot: null, unavailable: true })).toMatchObject({ reason: 'snapshot' });
    expect(band({ unbound: true })).toMatchObject({ kind: 'unreadable', reason: 'session-id' });
    expect(band({ snapshot: null })).toEqual({ kind: 'ready' });
    expect(band({ unavailable: true })).toMatchObject({ kind: 'feature' });
  });

  it('AC-4: a bound session with no record names the folder it looked in', () => {
    expect(
      band({ snapshot: null, missingRecord: { root: '/home/dev/code/app', home: '/home/dev' } }),
    ).toEqual({
      kind: 'missing',
      line: `${RECORD_MISSING} ~/code/app`,
      hint: RECORD_MISSING_HINT,
    });
    expect(band({ missingRecord: { root: '/work', home: null } })).toMatchObject({
      kind: 'feature',
    });
    expect(
      band({ snapshot: null, unbound: true, missingRecord: { root: '/w', home: null } }),
    ).toMatchObject({ kind: 'unreadable' });
  });

  it('AC-25: a workflow band is never drawn from a snapshot older than the prompt just sent', () => {
    const question = parse(
      snapshot({ ...OTHER_WORKFLOW, generated_at: new Date(NOW - 5_000).toISOString() }),
    );
    expect(band({ snapshot: question, turnStartedAt: NOW - 1_000 }).kind).not.toBe('workflow');
    expect(band({ snapshot: question, turnStartedAt: NOW - 9_000 }).kind).toBe('workflow');
    expect(band({ snapshot: question, turnStartedAt: null }).kind).toBe('workflow');
  });

  it('row 2: another workflow gets the workflow band, and no workflow draws nothing', () => {
    expect(band({ snapshot: parse(OTHER_WORKFLOW) })).toEqual({
      kind: 'workflow',
      words: 'Question',
      running: false,
      clock: null,
      cost: 'counting',
    });
    const priced = parse(
      snapshot({
        ...OTHER_WORKFLOW,
        route: 'codebase-health',
        workflow: {
          name: 'codebase-health',
          started_at: null,
          tokens: 84000,
          usd: 0.05,
          unpriced: [],
        },
      }),
    );
    expect(band({ snapshot: priced, turnStartedAt: NOW - 283_000 })).toEqual({
      kind: 'workflow',
      words: 'Codebase health',
      running: true,
      clock: '4:43',
      cost: '84K tokens · ~$0.05',
    });
    expect(band({ snapshot: parse(snapshot({ route: 'no-workflow' })) })).toEqual({
      kind: 'none',
    });
    expect(band({ snapshot: parse(snapshot()) })).toEqual({ kind: 'none' });
  });

  it('the feature route draws nothing without the no-change-yet reason', () => {
    const idle = parse(snapshot({ route: 'feature-development' }));
    expect(band({ snapshot: idle })).toEqual({ kind: 'none' });
    expect(band({ snapshot: { ...open(), active: false } })).toEqual({ kind: 'none' });
  });

  it('row 3: a question waiting for you leads the snapshot row', () => {
    const waiting = (waitingOn: 'question') =>
      desktopHeadline(
        open({
          decisions: { pending: [other], resolved: 0 },
          headline: { text: '1 decision is waiting for you', tone: 'needs-you', row: 6 },
        }),
        NOW,
        { ...IDLE_LIVE, turnId: 't', waitingOn },
      );
    expect(waiting('question')).toEqual({
      row: 3,
      signal: 'attention',
      tone: 'needs-you',
      live: false,
      text: WAITING_FOR_ANSWER,
      word: 'Waiting for your answer',
      note: null,
      gap: null,
      clock: null,
      activity: [],
    });
  });

  it('AC-32: draws the row, words and tone the snapshot decided, computing none of its own', () => {
    const failing = {
      verdict: { kind: 'fail', word: 'Needs your attention', reasons: [] },
      gates: [
        { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'fail' },
      ],
      ship: { ...PR_OPEN, merged: true, pr_state: 'merged' },
    };
    expect(
      head({ ...failing, headline: { text: 'Done', tone: 'good', row: 16, word: 'Done' } }),
    ).toEqual({
      row: 16,
      signal: 'pass',
      tone: 'good',
      live: false,
      text: 'Done',
      word: 'Done',
      note: null,
      gap: null,
      clock: null,
      activity: [],
    });
    const tones: Array<[string, string]> = [
      ['needs-you', 'attention'],
      ['good', 'pass'],
      ['bad', 'fail'],
      ['warn', 'caution'],
      ['working', 'accent'],
      ['neutral', 'idle'],
    ];
    for (const [tone, signal] of tones) {
      expect(head({ headline: { text: 'x', tone, row: 18 } }).signal).toBe(signal);
    }
  });

  it('AC-10, AC-33: carries the dim note and the neutral paqad line the snapshot wrote', () => {
    const done = head({
      headline: {
        text: 'Done',
        tone: 'good',
        row: 16,
        word: 'Done',
        rung: 'done',
        note: 'not committed',
        gap: 'paqad could not record the lane for this change',
      },
    });
    expect(done).toMatchObject({
      signal: 'pass',
      text: 'Done',
      note: 'not committed',
      gap: 'paqad could not record the lane for this change',
    });
    expect(JSON.stringify(done)).not.toContain('Fix it');
  });

  it('times a live row from the snapshot clock start, and only a live row', () => {
    const running = (over: Raw) =>
      head({ headline: { text: 'Building', tone: 'working', row: 15, ...over } });
    expect(running({ clock_from: '2026-10-18T08:58:00.000Z' })).toMatchObject({
      live: true,
      signal: 'accent',
      clock: '2:00',
    });
    expect(running({}).clock).toBeNull();
    expect(
      head({
        headline: { text: 'Done', tone: 'good', row: 16, clock_from: '2026-10-18T08:58:00.000Z' },
      }).clock,
    ).toBeNull();
  });

  it('AC-31: an older snapshot with no row shows its own words, never a pass it did not prove', () => {
    const old = head({
      verdict: { kind: 'pass', word: 'Safe to merge', reasons: [] },
      ship: { ...PR_OPEN, all_green: true, ci: { state: 'pass', done: 6, total: 6 } },
      headline: { text: 'Build in progress. Next: Review.', tone: 'working' },
    });
    expect(old).toMatchObject({ row: 0, text: 'Build in progress. Next: Review.' });
    expect(old.signal).not.toBe('pass');
    expect(head({ headline: { text: '', tone: 'good' } }).text).toBe(
      'Not yet. paqad has no record for this session.',
    );
  });

  it('a rule stop, used or not, never asks for you', () => {
    const settled = { text: 'Next: Plan', tone: 'neutral', row: 19 };
    expect(
      head({ headline: settled, last_block: { text: 'x', title: 'No React.FC', rule: 'RL-693b' } })
        .row,
    ).toBe(19);
    expect(head({ headline: settled, last_block: { text: 'x', used: true } }).row).toBe(19);
    expect(
      band({
        snapshot: open({ last_block: { text: 'x' } }),
        visibility: { ...SHOWN, closed: true },
      }),
    ).toEqual({ kind: 'closed', needsYou: false });
  });

  it('only live rows breathe', () => {
    expect(bandIsLive(band({ snapshot: parse(FAST_ORD_490) }))).toBe(true);
    expect(bandIsLive(band())).toBe(false);
    expect(bandIsLive(band({ snapshot: parse(OTHER_WORKFLOW), turnStartedAt: NOW }))).toBe(true);
    expect(bandIsLive(band({ snapshot: parse(OTHER_WORKFLOW) }))).toBe(false);
    expect(bandIsLive(band({ snapshot: null }))).toBe(false);
  });
});

describe('the identity row', () => {
  it('names the workflow, the lane, the change and the cost, only the parts that apply', () => {
    const full = parse(snapshot({ ...FULL_ORD_501, cost: costRecord() }));
    expect(identityView(full)).toEqual({
      parts: ['Feature', 'Full lane', 'ORD-501'],
      cost: '1.3M tokens · ~$4.60',
      flags: 1,
    });
    expect(identityText(identityView(full))).toBe('   Feature  ·  Full lane  ·  ORD-501');
    const idle = parse(snapshot({ route: 'feature-development', lane: 'fast' }));
    expect(identityView(idle)).toEqual({ parts: ['Feature'], cost: null, flags: 0 });
    expect(identityView(open({ lane: 'sideways' })).parts).toEqual(['Feature', 'ORD-501']);
  });

  it('AC-7: drops the cost, then the lane, then the workflow as the row narrows; the chip stays', () => {
    const full = parse(snapshot({ ...FULL_ORD_501, cost: costRecord() }));
    const wide = identityView(full, 93);
    expect(wide).toEqual({
      parts: ['Feature', 'Full lane', 'ORD-501'],
      cost: '1.3M tokens · ~$4.60',
      flags: 1,
    });
    const width = (view: typeof wide) =>
      'paqad'.length +
      identityText(view).length +
      1 +
      (view.cost ? view.cost.length + 1 : 0) +
      flagLabel(view.flags).length +
      1 +
      CONTROLS_COLUMNS;
    const fits = width(wide);
    expect(identityView(full, fits)).toEqual(wide);
    expect(identityView(full, fits - 1)).toEqual({
      parts: ['Feature', 'Full lane', 'ORD-501'],
      cost: null,
      flags: 1,
    });
    const noCost = { parts: ['Feature', 'Full lane', 'ORD-501'], cost: null, flags: 1 };
    expect(identityView(full, width(noCost) - 1).parts).toEqual(['Feature', 'ORD-501']);
    const noLane = { parts: ['Feature', 'ORD-501'], cost: null, flags: 1 };
    expect(identityView(full, width(noLane) - 1).parts).toEqual(['ORD-501']);
    expect(identityView(full, 10)).toEqual({ parts: ['ORD-501'], cost: null, flags: 1 });
    expect(flagLabel(1)).toBe('⚑ 1 flag');
    expect(flagLabel(2)).toBe('⚑ 2 flags');
  });

  it('AC-7: never says so far while the turn is counted, whole session when it is, and tokens when unpriced', () => {
    const cost = parse(snapshot({ ...FULL_ORD_501, cost: costRecord() })).cost!;
    expect(costWords({ ...cost, live: true })).toBe('1.3M tokens · ~$4.60');
    expect(costWords({ ...cost, scope: 'whole-session' })).toBe('1.3M tokens · whole session');
    expect(costWords({ ...cost, usd: null })).toBe('1.3M tokens');
    expect(costWords(null)).toBeNull();
  });
});

describe('AC-10, AC-29: the strip draws only what applies', () => {
  it('AC-11: draws the working stages: six on graduated, full or unresolved, three on the fast lane', () => {
    expect(stageStrip(open()).stages.map((mark) => mark.label)).toEqual([
      'Plan',
      'Spec',
      'Build',
      'Review',
      'Checks',
      'Docs',
    ]);
    expect(stageStrip(open({ lane: null })).stages).toHaveLength(6);
    expect(stageStrip(open({ lane: 'graduated' })).stages).toHaveLength(6);
    expect(stageStrip(open({ lane_stages: undefined })).stages).toHaveLength(6);
    expect(stageWord('ticket_intake')).toBe('Intake');
    expect(stageWord('delivery')).toBe('Deliver');
    expect(stageStrip(parse(FAST_ORD_490)).stages).toEqual([
      { label: 'Plan', state: 'done' },
      { label: 'Build', state: 'run' },
      { label: 'Checks', state: 'todo' },
    ]);
  });

  it('draws only the delivery steps in the plan, with the words for what is left out', () => {
    const steps = (plan: Raw) =>
      deliveryStrip(open({ delivery_plan: plan })).steps.map((step) => step.label);
    const all = { commit: true, push: true, pr: true, ci: true, merge: true, reason: null };
    expect(steps(all)).toEqual(['Edit', 'Commit', 'Push', 'PR', 'CI']);
    expect(steps({ ...all, ci: false, reason: 'No CI' })).toEqual(['Edit', 'Commit', 'Push', 'PR']);
    expect(deliverySteps(parse(snapshot({ delivery_plan: null })))).toEqual([
      'Edit',
      'Commit',
      'Push',
      'PR',
      'CI',
    ]);
    const editOnly = {
      commit: false,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: 'Edit only · no commit',
    };
    expect(steps(editOnly)).toEqual(['Edit']);
    expect(deliveryStrip(open({ delivery_plan: editOnly })).value).toBe('Edit only · no commit');
    const noPush = { ...editOnly, commit: true, reason: 'No push for this change' };
    expect(steps(noPush)).toEqual(['Edit', 'Commit']);
    expect(
      deliveryStrip(open({ delivery_plan: noPush, ship: { ...SHIP0, commits: 2 } })).value,
    ).toBe('No push for this change');
    expect(steps({ delivery_plan: null } as Raw)).toHaveLength(5);
    expect(deliveryStrip(open({ delivery_plan: null })).steps).toHaveLength(5);
  });

  it('before a change opens the stages and delivery are faint, with no table and no values', () => {
    const idle = parse(
      snapshot({
        route: 'feature-development',
        delivery_plan: {
          commit: false,
          push: false,
          pr: false,
          ci: false,
          merge: false,
          reason: 'Edit only · no commit',
        },
      }),
    );
    const strip = stripOf(idle, 93);
    expect(strip.stages.every((mark) => mark.state === 'todo')).toBe(true);
    expect(deliveryStrip(idle).steps).toEqual([{ label: 'Edit', state: 'todo' }]);
    expect(strip.seats).toBeNull();
    expect([strip.stageValue, strip.tableValue, strip.deliveryValue]).toEqual(['', '', '']);
  });

  it('R-3: marks each stage state and says the stage value', () => {
    const value = (over: Raw) => stageStrip(open(over)).value;
    expect(value({ stages: stages({ development: 'running' }) })).toBe('Build');
    const pausedStrip = stageStrip(
      open({
        stages: stages({ development: 'running' }),
        decisions: { pending: [other], resolved: 0 },
      }),
    );
    expect(pausedStrip.value).toBe('Build · paused');
    expect(pausedStrip.stages[2]).toEqual({ label: 'Build', state: 'paused' });
    expect(
      stageStrip(open({ stages: stages({ development: 'running' }), last_block: { text: 'x' } }))
        .value,
    ).toBe('Build');
    expect(
      stageStrip(open({ stages: stages({ development: 'running' }) }), {
        ...IDLE_LIVE,
        waitingOn: 'question',
      }).value,
    ).toBe('Build · paused');
    const waitingOnPermission = stageStrip(open({ stages: stages({ planning: 'running' }) }), {
      ...IDLE_LIVE,
      waitingOn: 'permission',
    });
    expect(waitingOnPermission.value).toBe('Plan');
    expect(waitingOnPermission.stages.find((mark) => mark.label === 'Plan')?.state).toBe('run');
    expect(value({ stages: stages({ review: 'failed' }) })).toBe('Review failed');
    const unreliable = stages({ planning: 'complete' }).map((stage) =>
      stage.stage === 'planning' ? { ...stage, duration_unreliable: true } : stage,
    );
    expect(value({ stages: unreliable })).toBe('Plan marked: no recorded work');
    expect(value({ stages: stages({ checks: 'complete' }) })).toBe('Checks: no test run recorded');
    expect(value({ stages: stages({ review: 'inconclusive' }) })).toBe('Review inconclusive');
    const skipped = stageStrip(open({ stages: stages({ planning: 'skipped' }) }));
    expect(skipped.stages[0]).toEqual({ label: 'Plan', state: 'skip' });
    const done = {
      ticket_intake: 'skipped',
      planning: 'complete',
      specification: 'complete',
      development: 'complete',
      review: 'complete',
      checks: 'complete',
      documentation_sync: 'complete',
      delivery: 'complete',
    };
    const gates = [
      { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
    ];
    expect(value({ stages: stages(done), gates })).toBe('All stages done');
    expect(value({ stages: stages(done), gates, ship: { ...SHIP0, merged: true } })).toBe(
      'All stages done',
    );
    expect(value({ stages: stages({ planning: 'complete' }) })).toBe('');
  });

  it('AC-8: says the delivery state in its 15 rows, first match wins, with its colour', () => {
    const line = (over: Raw) => {
      const strip = deliveryStrip(open(over));
      return [strip.value, strip.tone];
    };
    const green = { ...PR_OPEN, all_green: true, ci: { state: 'pass', done: 4, total: 4 } };
    expect(line({ ship: { ...PR_OPEN, pr_state: 'closed' } })).toEqual(['PR closed', 'fail']);
    expect(line({ ship: { ...PR_OPEN, pr_state: null } })).toEqual(['PR state unknown', 'ink']);
    expect(line({ ship: { ...PR_OPEN, ci: { state: 'fail', done: 6, total: 6 } } })).toEqual([
      'CI failed',
      'fail',
    ]);
    expect(line({ ship: { ...PR_OPEN, ci: { state: 'pending', done: 3, total: 6 } } })).toEqual([
      `${PR} · CI running`,
      'acc',
    ]);
    expect(line({ ship: green })).toEqual([`${PR} · 4 checks green`, 'ink']);
    expect(line({ ship: { ...green, ci: { state: 'pass', done: null, total: null } } })).toEqual([
      `${PR} · checks green`,
      'ink',
    ]);
    expect(line({ ship: PR_OPEN })).toEqual([PR, 'ink']);
    expect(line({ ship: { ...PR_OPEN, merged: true, pr_state: 'merged' } })).toEqual([PR, 'ink']);
    const noCi = { commit: true, push: true, pr: true, ci: false, merge: true, reason: 'No CI' };
    expect(line({ ship: green, delivery_plan: noCi })).toEqual([PR, 'ink']);
    expect(
      line({
        ship: { ...PR_OPEN, ci: { state: 'pending', done: 3, total: 6 } },
        delivery_plan: noCi,
      }),
    ).toEqual([PR, 'ink']);
    expect(line({ ship: { ...SHIP0, push: { state: 'failed' } } })).toEqual([
      'Push failed',
      'fail',
    ]);
    expect(line({ ship: { ...SHIP0, push: { state: 'pushed', branch: 'feat/x' } } })).toEqual([
      'Pushed · feat/x',
      'ink',
    ]);
    expect(line({ ship: { ...SHIP0, push: { state: 'pushed' } } })).toEqual(['Pushed', 'ink']);
    const editOnly = {
      commit: false,
      push: false,
      pr: false,
      ci: false,
      merge: false,
      reason: null,
    };
    expect(line({ delivery_plan: editOnly })).toEqual(['Edit only · no commit', 'mut']);
    expect(line({ delivery_plan: { ...editOnly, commit: true } })).toEqual([
      'No push for this change',
      'mut',
    ]);
    expect(line({ ship: { ...SHIP0, commits: 1 } })).toEqual(['Not pushed', 'ink']);
    expect(line({ ship: { ...SHIP0, commits: 3 } })).toEqual(['Not pushed', 'ink']);
    expect(line({ stages: stages({ development: 'running' }) })).toEqual(['Editing', 'acc']);
    expect(line({ stages: stages({ development: 'complete' }) })).toEqual([
      'Edited, not committed',
      'ink',
    ]);
    expect(line({})).toEqual(['Not started', 'mut']);
  });

  it('AC-8: line 2 takes ship.diff first, then the PR figures, and is empty with no changed line', () => {
    const figures = (ship: Raw) => deliveryStrip(open({ ship })).figures;
    const diff = { additions: 6375, deletions: 983, partial: false };
    expect(figures({ ...PR_OPEN, commits: 53, pr_additions: 1, pr_deletions: 1, diff })).toEqual({
      commits: 53,
      additions: 6375,
      deletions: 983,
      partial: false,
    });
    expect(figures({ ...PR_OPEN, commits: 2, pr_additions: 10, pr_deletions: 4 })).toEqual({
      commits: 2,
      additions: 10,
      deletions: 4,
    });
    expect(figures({ ...SHIP0, commits: 2 })).toBeNull();
    expect(
      figures({
        ...PR_OPEN,
        pr_additions: 10,
        pr_deletions: 4,
        diff: { additions: 0, deletions: 0 },
      }),
    ).toBeNull();
  });

  it('R-4: draws each delivery node state, with the CI share only while CI runs', () => {
    const strip = deliveryStrip(
      open({
        stages: stages({ development: 'complete' }),
        ship: { ...PR_OPEN, ci: { state: 'pending', done: 3, total: 6 } },
      }),
    );
    expect(strip.steps).toEqual([
      { label: 'Edit', state: 'done' },
      { label: 'Commit', state: 'done' },
      { label: 'Push', state: 'done' },
      { label: 'PR', state: 'done' },
      { label: 'CI', state: 'run' },
    ]);
    expect(strip.ci).toBe(0.5);
    const ready = deliveryStrip(
      open({ ship: { ...PR_OPEN, all_green: true, ci: { state: 'pass', done: 6, total: 6 } } }),
    );
    expect(ready.steps.at(-1)).toEqual({ label: 'CI', state: 'done' });
    expect(ready.ci).toBeNull();
    const closed = deliveryStrip(open({ ship: { ...PR_OPEN, pr_state: 'closed' } }));
    expect(closed.steps[3]).toEqual({ label: 'PR', state: 'fail' });
    expect(deliveryStrip(open({ ship: { ...PR_OPEN, pr_state: null } })).steps[3]?.state).toBe(
      'todo',
    );
  });

  it('R-5: draws the High Table seats and chief, the only value being Needs answers, and leaves a skipped table out', () => {
    expect(tableStrip(open({ table: ord501Table('seated') }))).toMatchObject({
      chief: 'waiting',
      value: '',
    });
    const writing = tableStrip(open({ table: ord501Table('landing') }));
    expect(writing.value).toBe('');
    expect(writing.seats).toEqual([
      { label: 'AA', state: 'writing' },
      { label: 'SA', state: 'writing' },
      { label: 'DE', state: 'writing' },
    ]);
    expect(writing.hidden).toBe(4);
    expect(tableStrip(open({ table: ord501Table('chief') }))).toMatchObject({
      chief: 'ruling',
      value: '',
    });
    expect(
      tableStrip(
        open({ table: ord501Table('ruled'), decisions: { pending: [conflict], resolved: 0 } }),
      ),
    ).toMatchObject({ chief: 'needs', value: 'Needs answers' });
    expect(tableStrip(open({ table: ord501Table('ruled') }))).toMatchObject({
      chief: 'done',
      value: '',
    });
    expect(
      tableStrip(
        open({ table: ord501Table('frozen'), stages: stages({ specification: 'complete' }) }),
      ),
    ).toMatchObject({ value: '' });
    const late = ord501Table('frozen') as { seats: Raw[] };
    late.seats[0] = { ...late.seats[0], late: true };
    expect(tableStrip(open({ table: late })).seats?.[0]).toEqual({ label: 'PO', state: 'late' });
    expect(
      tableStrip(open({ table: { ...ord482Table('ruled'), skipped: true } })).seats,
    ).toBeNull();
    expect(tableStrip(open({ lane: 'fast', table: ord501Table('ruled') })).seats).toBeNull();
    expect(tableStrip(open())).toEqual({ seats: null, chief: 'waiting', value: '', hidden: 0 });
  });

  it('AC-12, AC-13: keeps three seats, writing then late then newest done then seated, and counts the rest', () => {
    const at = (minute: number | null) =>
      minute === null ? null : `2026-10-18T08:${String(minute).padStart(2, '0')}:00.000Z`;
    const seat = (role: string, state: string, done: number | null = null, late = false) => ({
      ...(ord501Table('ruled') as { seats: Raw[] }).seats[0],
      role,
      state,
      done_at: at(done),
      late,
    });
    const table = (seats: Raw[]) => tableStrip(open({ table: { ...ord501Table('ruled'), seats } }));
    const labels = (seats: Raw[]) => table(seats).seats?.map((mark) => mark.label);
    const doneOnly = [
      seat('product-owner', 'done', 10),
      seat('application-architect', 'done', 30),
      seat('user-flow-writer', 'done', null),
      seat('qa-engineer', 'done', 20),
    ];
    expect(labels(doneOnly)).toEqual(['AA', 'QA', 'PO']);
    expect(table(doneOnly).hidden).toBe(1);
    const mixed = [
      seat('product-owner', 'seated'),
      seat('application-architect', 'done', 40),
      seat('user-flow-writer', 'writing', null, true),
      seat('qa-engineer', 'writing'),
    ];
    expect(table(mixed).seats).toEqual([
      { label: 'QA', state: 'writing' },
      { label: 'UF', state: 'late' },
      { label: 'AA', state: 'done' },
    ]);
    const ties = [
      seat('product-owner', 'done', 10),
      seat('application-architect', 'done', null),
      seat('user-flow-writer', 'done', 10),
      seat('qa-engineer', 'done', null),
    ];
    expect(labels(ties)).toEqual(['PO', 'UF', 'AA']);
    const three = table(doneOnly.slice(0, 3));
    expect(three.seats).toHaveLength(3);
    expect(three.hidden).toBe(0);
    const eleven = Array.from({ length: 11 }, (_, i) => seat(`role-${i}`, 'done', i));
    expect(table(eleven)).toMatchObject({ hidden: 8 });
    expect(table(eleven).seats).toHaveLength(3);
    const strip57 = stripOf(open({ table: { ...ord501Table('chief'), seats: eleven } }), 57);
    expect(strip57.seats).toHaveLength(3);
    expect(stripAlts('Building', strip57).table).toBe(
      'High Table: chief ruling, 11 seats, 3 shown.',
    );
    const strip93 = stripOf(open({ table: { ...ord501Table('chief'), seats: eleven } }), 93);
    expect(stripAlts('Building', strip93).table).toBe(
      'High Table: chief ruling, 11 seats, 3 shown.',
    );
  });

  it('AC-23: names the shown count in the High Table alt, and each section says its own words', () => {
    const strip = stripOf(open({ table: ord501Table('chief') }), 93);
    expect(stripAlts('Building', { ...strip, hiddenSeats: 8 }).table).toBe(
      'High Table: chief ruling, 11 seats, 3 shown.',
    );
    expect(stripAlts('Building', { ...strip, hiddenSeats: 0 }).table).toBe(
      'High Table: chief ruling, 3 seats.',
    );
    expect(stripAlts('Building', { ...strip, chief: 'done', hiddenSeats: 0 }).table).toBe(
      'High Table: chief ruled, 3 seats.',
    );
    expect(stripAlts('Building', { ...strip, chief: 'waiting', hiddenSeats: 0 }).table).toBe(
      'High Table: chief waiting, 3 seats.',
    );
    expect(
      stripAlts('Building', {
        ...strip,
        chief: 'needs',
        tableValue: 'Needs answers',
        hiddenSeats: 1,
      }).table,
    ).toBe('High Table: Needs answers, 4 seats, 3 shown.');
    const figures = { commits: 53, additions: 6375, deletions: 983 };
    const ci = {
      ...strip,
      hiddenSeats: 0,
      deliveryValue: `${PR} · CI running`,
      deliveryFigures: figures,
    };
    expect(stripAlts('Building', ci).delivery).toBe(
      `Delivery ${PR} · CI running. 53 commits, 6,375 lines added, 983 lines removed.`,
    );
    expect(stripAltText('Building', ci)).toContain(
      `High Table: chief ruling, 3 seats. Delivery ${PR} · CI running. 53 commits, 6,375 lines added, 983 lines removed.`,
    );
    expect(
      stripAlts('Building', { ...strip, deliveryValue: '', deliveryFigures: null }).delivery,
    ).toBe('Delivery Not started.');
    const fast = band({ snapshot: parse(FAST_ORD_490) });
    expect(fast.kind === 'feature' && fast.stripAlts).toMatchObject({
      stage: 'Building. Stage Build. Plan done.',
      delivery: 'Delivery Editing.',
    });
  });

  it('says the headline, the stage value and each section value in the strip alt', () => {
    const feature = band({ snapshot: parse(FAST_ORD_490) });
    expect(feature).toMatchObject({
      kind: 'feature',
      alt: 'Building. Stage Build. Plan done. Delivery Editing.',
    });
  });
});

describe('AC-16: the card falls back to the minimised row when it does not fit', () => {
  it('AC-16: always reserves the line under the headline: identity, message, gap and strip', () => {
    expect(CARD_ROWS).toEqual({ identity: 1, message: 1, gap: 1, strip: 3, menu: 1 });
    expect(cardRows(false)).toBe(6);
    expect(cardRows(true)).toBe(7);
  });

  it('draws the minimised row at 5 rows, the card at 6, and the minimised row with the menu at 6', () => {
    expect(band({ maxRows: 5 })).toMatchObject({ kind: 'feature', mode: 'minimised', menu: false });
    expect(band({ maxRows: 6 })).toMatchObject({ kind: 'feature', mode: 'card', menu: false });
    expect(band({ maxRows: 6, menuOpen: true })).toMatchObject({ mode: 'minimised', menu: true });
    expect(band({ maxRows: 7, menuOpen: true })).toMatchObject({ mode: 'card', menu: true });
  });

  it('AC-16: a headline with a gap line and one without fit the same rows', () => {
    const withGap = open({
      headline: { text: 'Done', tone: 'good', row: 16, gap: 'No record yet for: Docs' },
    });
    const withoutGap = open({ headline: { text: 'Next: Plan', tone: 'neutral', row: 19 } });
    for (const maxRows of [5, 6]) {
      expect(band({ snapshot: withGap, maxRows })).toMatchObject({
        mode: band({ snapshot: withoutGap, maxRows }).mode,
      });
    }
  });
});

describe('AC-14: minimised, closed and hidden', () => {
  it('minimises on request, with the stage and clock when live, or the static word', () => {
    const live = band({ snapshot: parse(FAST_ORD_490), visibility: { ...SHOWN, minimised: true } });
    expect(live).toMatchObject({
      kind: 'feature',
      mode: 'minimised',
      minimised: {
        light: 'accent',
        live: true,
        text: 'Build · 2:00',
        stages: ['done', 'run', 'todo'],
        cost: null,
      },
    });
    const settled = band({
      snapshot: open({ headline: { text: 'Next: Plan', tone: 'neutral', row: 19 } }),
      visibility: { ...SHOWN, minimised: true },
    });
    expect(settled).toMatchObject({
      minimised: { light: 'idle', live: false, text: 'Next: Plan' },
    });
    const unclocked = band({
      snapshot: open({ stages: [{ stage: 'development', state: 'running', mandatory: true }] }),
      visibility: { ...SHOWN, minimised: true },
    });
    expect(unclocked).toMatchObject({ minimised: { text: 'Build' } });
    const valued = band({
      snapshot: open({ stages: stages({ review: 'failed' }) }),
      visibility: { ...SHOWN, minimised: true },
    });
    expect(valued).toMatchObject({ minimised: { text: 'Review failed' } });
    const priced = band({
      snapshot: parse(snapshot({ ...FULL_ORD_501, cost: costRecord() })),
      visibility: { ...SHOWN, minimised: true },
    });
    expect(priced).toMatchObject({ minimised: { cost: '1.3M tokens · ~$4.60' } });
  });

  it('closes for the session or hides, and says Waiting for your answer when something waits', () => {
    expect(band({ visibility: { ...SHOWN, closed: true } })).toEqual({
      kind: 'closed',
      needsYou: false,
    });
    expect(band({ visibility: { ...SHOWN, hidden: true, closed: true } })).toEqual({
      kind: 'hidden',
      needsYou: false,
    });
    expect(
      band({
        snapshot: open({ decisions: { pending: [other], resolved: 0 } }),
        visibility: { ...SHOWN, hidden: true },
      }),
    ).toEqual({ kind: 'hidden', needsYou: true });
  });
});

describe('AC-18: the task list carries the stages of the lane', () => {
  const call = (items: unknown[], extra: Raw = {}) => ({ items, ...extra });
  const full = ['Plan the change', 'Spec', 'Build it', 'Review', 'Checks', 'Docs'];

  it('passes the stage words as item openings in order, with any other items around them', () => {
    expect(refusesTaskList('full', call(full.map((content) => ({ content }))))).toBe(false);
    expect(
      refusesTaskList(
        'graduated',
        call(
          ['Read the ticket', ...full, 'Open the PR'].map((content) => ({
            content: `  ${content.toUpperCase()} `,
          })),
        ),
      ),
    ).toBe(false);
    expect(refusesTaskList('fast', call(['Plan', 'Build', 'Write notes', 'Checks']))).toBe(false);
  });

  it('refuses a list that misses a stage word or has them out of order', () => {
    expect(refusesTaskList('full', call([{ content: 'Plan' }, { content: 'Build' }]))).toBe(true);
    expect(refusesTaskList('fast', call(['Build', 'Plan', 'Checks']))).toBe(true);
    expect(refusesTaskList(null, call(['Plan', 'Build', 'Checks']))).toBe(true);
    expect(refusesTaskList('fast', call([{ title: 'Plan' }, null, 7]))).toBe(true);
  });

  it('never checks a call without items, or an advance, done or start call', () => {
    expect(refusesTaskList('full', {})).toBe(false);
    expect(refusesTaskList('full', { items: 'Plan' })).toBe(false);
    for (const action of ['advance', 'done', 'START']) {
      expect(refusesTaskList('full', call(['nothing'], { action }))).toBe(false);
    }
    expect(refusesTaskList('full', call(['nothing'], { type: 'done' }))).toBe(false);
    expect(refusesTaskList('full', call(['nothing'], { action: 'replace' }))).toBe(true);
  });

  it('answers with the verbatim sentence of the lane', () => {
    expect(taskListSentence('fast')).toBe(TASK_LIST_SENTENCES.fast);
    expect(taskListSentence('full')).toBe(TASK_LIST_SENTENCES.full);
    expect(taskListSentence(null)).toBe(
      'paqad task list: Plan, Spec, Build, Review, Checks, Docs. Start each item with that word, in this order. Items before Plan (read the ticket) and after Docs (open the PR) are fine.',
    );
    expect(TASK_LIST_SENTENCES.fast).toBe(
      'paqad task list: Plan, Build, Checks. Start each item with that word, in this order. Items before Plan and after Checks are fine.',
    );
  });
});

describe('the task list tool the HUD watches', () => {
  it('is the literal the tool.call matcher names', () => {
    expect(UPDATE_PLAN_TOOL).toBe('mcp__ccd_turn__update_plan');
  });
});

describe('FR-36: the strip alt names the finished stages in words', () => {
  it('lists every done stage after the stage value', () => {
    const input = {
      columns: 93,
      stages: [
        { label: 'Plan', state: 'done' as const },
        { label: 'Build', state: 'done' as const },
        { label: 'Checks', state: 'run' as const },
      ],
      stageValue: 'Checks',
      seats: null,
      chief: 'waiting' as const,
      tableValue: '',
      delivery: [],
      ci: null,
      deliveryValue: '2 commits of yours',
    };
    expect(stripAltText('Running the checks', input)).toBe(
      'Running the checks. Stage Checks. Plan, Build done. Delivery 2 commits of yours.',
    );
    expect(stripAltText('Next: Plan', { ...input, stages: [] })).not.toContain(' done.');
  });
});

describe('AC-12: the glow fires only when the last stage just ended', () => {
  const ended = (at: string) =>
    parse({
      ...FULL_ORD_501,
      stages: (FULL_ORD_501.stages as Raw[]).map((entry) =>
        entry.state === 'complete' ? { ...entry, ended_at: at } : entry,
      ),
    });

  it('names the change and the last end once every drawn stage is done', () => {
    const settled = settledChange(ended('2026-10-18T08:59:57.000Z'));
    expect(settled).toEqual({
      key: (FULL_ORD_501.change as Raw).dir,
      endedAt: Date.parse('2026-10-18T08:59:57.000Z'),
    });
    expect(settledChange(parse(FAST_ORD_490))).toBeNull();
    expect(settledChange(parse({ ...FULL_ORD_501, active: false }))).toBeNull();
  });

  it('starts the glow at the first sighting only within 10 s of the end', () => {
    const end = Date.parse('2026-10-18T08:59:57.000Z');
    expect(SETTLE_WINDOW_MS).toBe(10_000);
    expect(settleStart(end, end + 3_000)).toBe(end + 3_000);
    expect(settleStart(end, end + 10_001)).toBeNull();
    expect(settleStart(end, end - 60_000)).toBeNull();
    expect(settleStart(null, end)).toBeNull();
  });
});

describe('the headline stays on one line', () => {
  const LONG =
    'The chief architect is ruling on every disagreement the High Table raised about this change';

  it('cuts a long Desktop headline to the band width with an ellipsis and keeps it whole in the alt', () => {
    const drawn = band({
      columns: 57,
      snapshot: parse({ ...FULL_ORD_501, headline: { text: LONG, tone: 'working', row: 15 } }),
    });
    expect(drawn.kind).toBe('feature');
    if (drawn.kind !== 'feature') return;
    expect(drawn.headline.text.endsWith('…')).toBe(true);
    expect([...drawn.headline.text].length).toBeLessThanOrEqual(55);
    expect(drawn.alt.startsWith(`${LONG}.`)).toBe(true);
    const short = band({ columns: 57 });
    expect(short.kind === 'feature' && short.headline.text.endsWith('…')).toBe(false);
  });
});

describe('the live headline says itself in words', () => {
  it('names the sentence, the note and the clock', () => {
    expect(headlineAlt({ text: 'Building', note: null, clock: '2:01' })).toBe(
      'Building. Running for 2 min 1 s.',
    );
    expect(
      headlineAlt({ text: 'Subagent: Review the change', note: '3 finished', clock: null }),
    ).toBe('Subagent: Review the change. 3 finished.');
    expect(headlineAlt({ text: 'Delivering.', note: null, clock: '1:02:03' })).toBe(
      'Delivering. Running for 1 h 2 min 3 s.',
    );
  });

  it('keeps the whole sentence in the alt when the title is cut to the band', () => {
    const long = 'Building the change with a headline far too long for the narrow band';
    const drawn = band({
      columns: 30,
      snapshot: open({ headline: { text: long, tone: 'working', row: 9, word: 'Working' } }),
    });
    expect(drawn.kind === 'feature' && drawn.headline.text.endsWith('…')).toBe(true);
    expect(drawn.kind === 'feature' && drawn.headlineAlt).toBe(`${long}.`);
  });
});

describe('live subagents lead the band while they run', () => {
  const agents = {
    running: [
      { id: 'a1', description: 'Plan the change', status: 'running' },
      { id: 'a2', description: 'Review the change', status: 'running' },
    ],
    lines: ['Bash: pnpm test', 'Read: src/a.ts'],
    finished: 3,
  };

  it('titles the newest subagent, breathes the light and draws only the newest line', () => {
    const drawn = band({ live: { ...IDLE_LIVE, agents } });
    expect(drawn.kind).toBe('feature');
    if (drawn.kind !== 'feature') return;
    expect(drawn.headline).toMatchObject({
      text: 'Subagent: Review the change',
      live: true,
      signal: 'accent',
      note: '3 finished',
    });
    expect(drawn.activity).toEqual(['Bash: pnpm test']);
    expect(bandIsLive(drawn)).toBe(true);
  });

  it('Waiting for your answer wins over the subagent title', () => {
    const drawn = band({ live: { ...IDLE_LIVE, agents, waitingOn: 'question' } });
    expect(drawn.kind === 'feature' && drawn.headline.text).toBe('Waiting for your answer');
    expect(drawn.kind === 'feature' && drawn.activity).toEqual([]);
  });

  it('a pending decision of this change wins over the subagent title too', () => {
    const drawn = band({
      live: { ...IDLE_LIVE, agents },
      snapshot: parse({
        ...FULL_ORD_501,
        headline: {
          text: 'Waiting for your answer',
          tone: 'needs-you',
          row: 6,
          word: 'Waiting for your answer',
        },
      }),
    });
    expect(drawn.kind === 'feature' && drawn.headline.text).toBe('Waiting for your answer');
    expect(drawn.kind === 'feature' && drawn.activity).toEqual([]);
  });

  it('falls back to the normal headline with nothing running', () => {
    const idle = band({ live: { ...IDLE_LIVE, agents: { ...agents, running: [] } } });
    const plain = band();
    expect(idle.kind === 'feature' && idle.headline.text).toBe(
      plain.kind === 'feature' && plain.headline.text,
    );
    expect(idle.kind === 'feature' && idle.activity).toEqual([]);
  });

  it('keeps the card at 6 rows: the body line takes the gap slot, not a row of its own', () => {
    expect(cardRows(false)).toBe(6);
    const fit = band({ live: { ...IDLE_LIVE, agents }, maxRows: 6 });
    expect(fit.kind === 'feature' && fit.mode).toBe('card');
    expect(fit.kind === 'feature' && fit.activity).toEqual(['Bash: pnpm test']);
    const tight = band({ live: { ...IDLE_LIVE, agents }, maxRows: 5 });
    expect(tight.kind === 'feature' && tight.mode).toBe('minimised');
    const quiet = band({ maxRows: 6 });
    expect(quiet.kind === 'feature' && quiet.mode).toBe('card');
  });
});

describe('Paqad Getting Ready', () => {
  const ready = (over: Raw = {}) =>
    parse(
      snapshot({
        route: 'feature-development',
        active: false,
        scope: { qualified: false, reason: 'no-change-yet' },
        ...over,
      }),
    );
  const LABELS = ['Plan', 'Spec', 'Build', 'Review', 'Checks', 'Docs'];

  function card(over: Partial<DesktopBandInput> = {}) {
    const drawn = band({ snapshot: ready(), ...over });
    if (drawn.kind !== 'ready-feature') throw new Error(`drew ${drawn.kind}`);
    return drawn;
  }

  it('draws the card with the headline and 6 not-yet stages', () => {
    const drawn = card();
    expect(drawn.mode).toBe('card');
    expect(drawn.headline).toMatchObject({ text: 'Paqad Getting Ready', live: false, clock: null });
    expect(GETTING_READY).toBe('Paqad Getting Ready');
    expect(drawn.strip.stages.map((mark) => mark.label)).toEqual(LABELS);
    expect(new Set(drawn.strip.stages.map((mark) => mark.state))).toEqual(new Set(['todo']));
    expect(drawn.strip.deliveryFigures).toBeNull();
    expect(bandIsLive(drawn)).toBe(false);
  });

  it('a fast lane keeps all 6 stages not-yet', () => {
    const drawn = card({ snapshot: ready({ lane: 'fast' }) });
    expect(drawn.strip.stages.map((mark) => mark.label)).toEqual(LABELS);
    expect(new Set(drawn.strip.stages.map((mark) => mark.state))).toEqual(new Set(['todo']));
  });

  it('AC-24: every other reason, or no scope, draws nothing', () => {
    for (const reason of ['closed', 'other-branch', 'no-row-this-episode', 'no-active-change']) {
      const other = ready({ scope: { qualified: false, reason } });
      expect(band({ snapshot: other })).toEqual({ kind: 'none' });
    }
    const raw = snapshot({ route: 'feature-development', active: false });
    delete (raw as Raw).scope;
    expect(band({ snapshot: parse(raw) })).toEqual({ kind: 'none' });
  });

  it('AC-24: a non-feature route never draws it, whatever the reason', () => {
    const question = parse(
      snapshot({
        route: 'project-question',
        active: false,
        scope: { qualified: false, reason: 'no-change-yet' },
      }),
    );
    expect(band({ snapshot: question }).kind).toBe('workflow');
    const notFeature = parse(
      snapshot({ route: 'no-workflow', scope: { qualified: false, reason: 'not-feature-route' } }),
    );
    expect(band({ snapshot: notFeature })).toEqual({ kind: 'none' });
  });

  it('AC-24: a snapshot older than the running turn draws nothing, between turns it draws', () => {
    const older = Date.parse(ready().generated_at) + 1000;
    expect(band({ snapshot: ready(), turnStartedAt: older })).toEqual({ kind: 'none' });
    expect(band({ snapshot: ready(), turnStartedAt: null }).kind).toBe('ready-feature');
  });

  it('AC-26: the identity line carries the lane only when one is set', () => {
    expect(identityText(card().identity)).toBe('   Feature');
    expect(identityText(card({ snapshot: ready({ lane: 'full' }) }).identity)).toBe(
      '   Feature  ·  Full lane',
    );
  });

  it('AC-27: the words say it reads with the colour gone', () => {
    const drawn = card();
    expect(drawn.headlineAlt).toBe('Paqad Getting Ready.');
    expect(drawn.alt).toBe('Paqad Getting Ready. Stage not started. Delivery Not started.');
    expect(drawn.stripAlts.stage).toContain('Stage not started');
    expect(drawn.stripAlts.delivery).toBe('Delivery Not started.');
    expect(drawn.minimised.stages).toEqual(LABELS.map(() => 'todo'));
  });

  it('AC-28: the Ledger for this state is the no-change view', () => {
    expect(
      buildDesktopLedger({
        snapshot: ready(),
        unbound: false,
        unavailable: false,
        tab: null,
        now: NOW,
        specText: null,
      }),
    ).toEqual({ kind: 'no-change', words: 'No change is in progress.' });
  });

  it('minimised, closed and hidden are honoured, and unreadable wins', () => {
    expect(card({ visibility: { ...SHOWN, minimised: true } }).mode).toBe('minimised');
    expect(band({ snapshot: ready(), visibility: { ...SHOWN, closed: true } })).toEqual({
      kind: 'closed',
      needsYou: false,
    });
    expect(band({ snapshot: ready(), visibility: { ...SHOWN, hidden: true } })).toEqual({
      kind: 'hidden',
      needsYou: false,
    });
    expect(band({ snapshot: ready(), unbound: true }).kind).toBe('unreadable');
  });

  it('a short or narrow window falls back to the minimised row and never clips', () => {
    expect(card({ maxRows: cardRows(false) }).mode).toBe('card');
    expect(card({ maxRows: cardRows(false) - 1 }).mode).toBe('minimised');
    expect(card({ columns: 40 }).mode).toBe('card');
    expect(card({ columns: 39 }).mode).toBe('minimised');
    const narrow = card({ columns: 12 });
    expect(narrow.mode).toBe('minimised');
    expect([...narrow.headline.text].length).toBeLessThanOrEqual(10);
  });

  it('AC-32: no snapshot yet still reads Ready', () => {
    expect(band({ snapshot: null })).toEqual({ kind: 'ready' });
  });
});

describe('Part C: the Sign-off stage, words and button', () => {
  const HOUR = 3_600_000;
  const WAITING = {
    state: 'awaiting_sign_off',
    ref: 'PQD-12',
    posted_at: new Date(NOW - 3 * HOUR).toISOString(),
    checked_at: new Date(NOW - 10 * 60_000).toISOString(),
    link: 'https://acme.test/1',
  };
  const signed = (over: Raw = {}) => open({ signoff: { ...WAITING, ...over } });
  const viewOf = (over: Raw = {}, extra: Partial<Parameters<typeof signoffView>[1]> = {}) =>
    signoffView(signed(over).signoff, { now: NOW, design: true, ...extra })!;
  const press = { ref: 'PQD-12', at: NOW - 60_000 };

  it('AC-14: each shown state has its bar, words, colour and button', () => {
    const row = (over: Raw, extra = {}) => {
      const view = viewOf(over, extra);
      return [view.state, view.bar, view.words, view.tone, view.label];
    };
    expect(row({ state: 'pending' })).toEqual(['pending', 'todo', null, null, null]);
    expect(row({ state: 'writing' })).toEqual(['writing', 'run', 'Writing design', 'acct', null]);
    expect(row({})).toEqual(['awaiting_sign_off', 'paused', 'Waiting 3h', 'caut', 'Check']);
    expect(row({}, { check: press })).toEqual(['checking', 'paused', 'Checking…', 'acct', null]);
    expect(row({ state: 'approved' })).toEqual(['approved', 'done', 'Signed off', 'passt', null]);
    expect(row({ state: 'changes_requested' })).toEqual([
      'changes_requested',
      'todo',
      'Changes requested',
      'fail',
      'View',
    ]);
    expect(row({ state: 'skipped' })).toEqual([
      'skipped',
      'skip',
      'Sign-off skipped',
      'mutt',
      null,
    ]);
    expect(row({ state: 'not_posted' })).toEqual([
      'not_posted',
      'skip',
      'Not posted',
      'mutt',
      'Copy design',
    ]);
    expect(viewOf({}).name).toBe('Check design sign-off for PQD-12');
    const strip = stagesOf(
      signed({ state: 'changes_requested' }),
      IDLE_LIVE,
      viewOf({ state: 'changes_requested' }),
    );
    expect(strip.stages.map((mark) => `${mark.label}:${mark.state}`)).toEqual([
      'Plan:todo',
      'Spec:run',
      'Sign-off:todo',
      'Build:todo',
      'Review:todo',
      'Checks:todo',
      'Docs:todo',
    ]);
    expect(strip.value).toBe('Spec');
    expect(stagesOf(signed(), IDLE_LIVE, viewOf({})).value).toBe('Sign-off');
  });

  it('AC-21: Copy design reads Copied for 2 s after a copy, and hides with no design text', () => {
    expect(viewOf({ state: 'not_posted' }, { copiedAt: NOW - 1_000 }).label).toBe('Copied');
    expect(viewOf({ state: 'not_posted' }, { copiedAt: NOW - 2_000 }).label).toBe('Copy design');
    const bare = viewOf({ state: 'not_posted' }, { design: false });
    expect([bare.words, bare.label, bare.action]).toEqual(['Not posted', null, null]);
  });

  it('AC-16, FR-21: Checking… shows only between a press and its clear event', () => {
    const signoff = signed().signoff!;
    expect(checkPending(signoff, press, NOW)).toBe(true);
    expect(checkPending(signoff, null, NOW)).toBe(false);
    expect(checkPending({ ...signoff, checked_at: new Date(NOW).toISOString() }, press, NOW)).toBe(
      false,
    );
    expect(checkPending({ ...signoff, state: 'approved' }, press, NOW)).toBe(false);
    expect(checkPending(signoff, press, press.at + CHECK_CEILING_MS)).toBe(false);
    expect(checkPending(signoff, { ...press, ref: 'PQD-9' }, NOW)).toBe(false);
  });

  it('AC-13, AC-12: pending keeps the bar count through the freeze; no sign-off draws no stage, words or minimised bar', () => {
    const pending = band({ snapshot: signed({ state: 'pending' }) });
    const writing = band({ snapshot: signed({ state: 'writing' }) });
    if (pending.kind !== 'feature' || writing.kind !== 'feature') throw new Error('no card');
    expect(pending.strip.stages).toHaveLength(7);
    expect(writing.strip.stages).toHaveLength(7);
    expect(pending.strip.signoff).toBeUndefined();
    expect(pending.minimised.stages).toHaveLength(7);
    const off = band({ snapshot: open({ signoff: null }) });
    if (off.kind !== 'feature') throw new Error('no card');
    expect(off.signoff).toBeNull();
    expect(off.strip.stages.map((mark) => mark.label)).not.toContain('Sign-off');
    expect(off.strip.signoff).toBeUndefined();
    expect(off.minimised.stages).toHaveLength(6);
    expect(off.alt).not.toMatch(/sign-off/i);
  });

  it('AC-24 NFR-2: the strip alt text carries the status words, the ref and the button name', () => {
    const drawn = band({ snapshot: signed() });
    if (drawn.kind !== 'feature') throw new Error('no card');
    const sentence =
      'Design sign-off for PQD-12: Waiting 3h. Check button: Check design sign-off for PQD-12.';
    expect(drawn.signoff?.name).toBe('Check design sign-off for PQD-12');
    expect(drawn.stripAlts.stage).toContain(sentence);
    expect(drawn.alt).toContain(sentence);
    const approved = band({ snapshot: signed({ state: 'approved' }) });
    if (approved.kind !== 'feature') throw new Error('no card');
    expect(approved.alt).toContain('Design sign-off for PQD-12: Signed off.');
  });

  it('AC-33: 7 bars hide the labels where 6 bars still fit them', () => {
    const room = 270;
    expect(stageBarPx(room, 6)).toBeGreaterThanOrEqual(LABEL_MIN_PX);
    expect(stageBarPx(room, 7)).toBeLessThan(LABEL_MIN_PX);
    const withSignoff = stagesOf(signed(), IDLE_LIVE, viewOf({})).stages.length;
    const without = stagesOf(open()).stages.length;
    expect(stageBarPx(room, withSignoff) >= LABEL_MIN_PX).toBe(false);
    expect(stageBarPx(room, without) >= LABEL_MIN_PX).toBe(true);
  });

  it('AC-20: waiting for sign-off is a caution headline with checked <age> ago', () => {
    const headline = desktopHeadline(
      open({
        signoff: WAITING,
        headline: { text: 'Waiting for sign-off on PQD-12', tone: 'warn', row: 21 },
      }),
      NOW,
    );
    expect(headline).toMatchObject({
      signal: 'caution',
      text: 'Waiting for sign-off on PQD-12',
      note: 'checked 10m ago',
    });
  });

  it('AC-22: the Ledger Trust tab names the sign-off and links the design record', () => {
    expect(signoffRecord(signed({ state: 'changes_requested' }))).toEqual({
      words: 'Design sign-off for PQD-12: changes requested',
      link: { href: 'https://acme.test/1', text: 'Open the design record' },
    });
    expect(signoffRecord(open({ signoff: null }))).toBeNull();
  });
});

describe('AC-4: the record-missing path shortens home and truncates in the middle', () => {
  it('shortens the home part to ~ only on a folder boundary', () => {
    expect(homeShortened('/home/dev', '/home/dev')).toBe('~');
    expect(homeShortened('/home/dev/app', '/home/dev')).toBe('~/app');
    expect(homeShortened('/home/devx/app', '/home/dev')).toBe('/home/devx/app');
    expect(homeShortened('C:\\Users\\u\\app', 'C:\\Users\\u')).toBe('~\\app');
    expect(homeShortened('/work/app', null)).toBe('/work/app');
  });

  it('keeps the last folder name and cuts the middle, never the end', () => {
    const path = '/very/long/path/that/goes/on/and/on/to/the-repo';
    const cut = middleTruncated(path, 24);
    expect([...cut].length).toBe(24);
    expect(cut.endsWith('/the-repo')).toBe(true);
    expect(cut.startsWith('/very')).toBe(true);
    expect(cut).toContain('…');
    expect(middleTruncated('/short', 24)).toBe('/short');
  });

  it('fits the narrow band and still shows the repo folder', () => {
    const line = recordMissingLine(
      '/home/dev/clients/acme/projects/2026/the-repo',
      '/home/dev',
      60,
    );
    expect(line.startsWith(RECORD_MISSING)).toBe(true);
    expect(line.endsWith('/the-repo')).toBe(true);
    expect([...line].length).toBeLessThanOrEqual(58);
  });
});

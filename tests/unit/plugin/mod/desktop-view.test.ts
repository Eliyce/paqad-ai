import { describe, expect, it } from 'vitest';

import {
  CARD_ROWS,
  TASK_LIST_SENTENCES,
  UNREADABLE,
  bandIsLive,
  buildDesktopBand,
  cardRows,
  costWords,
  deliveryStrip,
  desktopHeadline,
  identityText,
  identityView,
  refusesTaskList,
  stageStrip,
  stripOf,
  tableStrip,
  taskListSentence,
  WAITING_FOR_ANSWER,
  WAITING_FOR_PERMISSION,
  type DesktopBandInput,
} from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
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

  it('the feature route draws nothing until a change opens', () => {
    const idle = parse(snapshot({ route: 'feature-development' }));
    expect(band({ snapshot: idle })).toEqual({ kind: 'none' });
    expect(band({ snapshot: { ...open(), active: false } })).toEqual({ kind: 'none' });
  });

  it('rows 3 and 4: a question or a permission waiting for you leads the snapshot row', () => {
    const waiting = (waitingOn: 'question' | 'permission') =>
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
      word: 'Needs you',
      note: null,
      gap: null,
      clock: null,
    });
    expect(waiting('permission')).toMatchObject({ row: 4, text: WAITING_FOR_PERMISSION });
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
      parts: ['Feature development', 'Full lane', 'ORD-501', '1.3M tokens · ~$4.60'],
      flags: 1,
    });
    expect(identityText(identityView(full))).toBe(
      '   Feature development  ·  Full lane  ·  ORD-501  ·  1.3M tokens · ~$4.60',
    );
    const idle = parse(snapshot({ route: 'feature-development', lane: 'fast' }));
    expect(identityView(idle)).toEqual({ parts: ['Feature development'], flags: 0 });
    expect(identityView(open({ lane: 'sideways' })).parts).toEqual([
      'Feature development',
      'ORD-501',
    ]);
  });

  it('says so far while the turn is counted, whole session when it is, and tokens when unpriced', () => {
    const cost = parse(snapshot({ ...FULL_ORD_501, cost: costRecord() })).cost!;
    expect(costWords({ ...cost, live: true })).toBe('1.3M tokens so far · ~$4.60');
    expect(costWords({ ...cost, scope: 'whole-session' })).toBe('1.3M tokens · whole session');
    expect(costWords({ ...cost, usd: null })).toBe('1.3M tokens');
    expect(costWords(null)).toBeNull();
  });
});

describe('AC-10, AC-29: the strip draws only what applies', () => {
  it('draws the lane stages: all eight on graduated, full or unresolved, three on the fast lane', () => {
    expect(stageStrip(open()).stages.map((mark) => mark.label)).toEqual([
      'Intake',
      'Plan',
      'Spec',
      'Build',
      'Review',
      'Checks',
      'Docs',
      'Deliver',
    ]);
    expect(stageStrip(open({ lane: null })).stages).toHaveLength(8);
    expect(stageStrip(open({ lane: 'graduated' })).stages).toHaveLength(8);
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
    expect(steps(all)).toEqual(['Edit', 'Commit', 'Push', 'PR', 'CI', 'Merge']);
    expect(steps({ ...all, ci: false, reason: 'No CI' })).toEqual([
      'Edit',
      'Commit',
      'Push',
      'PR',
      'Merge',
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
    expect(steps({ delivery_plan: null } as Raw)).toHaveLength(6);
    expect(deliveryStrip(open({ delivery_plan: null })).steps).toHaveLength(6);
  });

  it('AC-6: before a change opens the stages and delivery are faint, with no table and no values', () => {
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
    expect(strip.delivery).toEqual([{ label: 'Edit', state: 'todo' }]);
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
    expect(pausedStrip.stages[3]).toEqual({ label: 'Build', state: 'paused' });
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
    const skipped = stageStrip(open({ stages: stages({ ticket_intake: 'skipped' }) }));
    expect(skipped.stages[0]).toEqual({ label: 'Intake', state: 'skip' });
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
      'Delivered',
    );
    expect(value({ stages: stages({ planning: 'complete' }) })).toBe('');
  });

  it('R-4: says the delivery value, first match wins', () => {
    const value = (over: Raw) => deliveryStrip(open(over)).value;
    expect(value({ ship: { ...PR_OPEN, merged: true, pr_state: 'merged' } })).toBe(`${PR} merged`);
    expect(
      value({ ship: { ...PR_OPEN, all_green: true, ci: { state: 'pass', done: 6, total: 6 } } }),
    ).toBe('Merge is yours');
    expect(value({ ship: { ...PR_OPEN, pr_state: 'closed' } })).toBe('PR closed');
    expect(value({ ship: { ...PR_OPEN, pr_state: null } })).toBe('PR state unknown');
    expect(value({ ship: { ...PR_OPEN, ci: { state: 'fail', done: 6, total: 6 } } })).toBe(
      'CI failed',
    );
    expect(value({ ship: { ...PR_OPEN, ci: { state: 'pending', done: 3, total: 6 } } })).toBe(
      '3 of 6 checks green',
    );
    const noCi = { commit: true, push: true, pr: true, ci: false, merge: true, reason: 'No CI' };
    expect(value({ ship: PR_OPEN, delivery_plan: noCi })).toBe('No CI · merge is yours');
    expect(value({ ship: PR_OPEN })).toBe(PR);
    expect(value({ ship: { ...SHIP0, push: { state: 'failed' } } })).toBe('Push failed');
    expect(value({ ship: { ...SHIP0, push: { state: 'pushed' } } })).toBe('Pushed');
    expect(value({ ship: { ...SHIP0, commits: 1 } })).toBe('1 commit of yours');
    expect(value({ ship: { ...SHIP0, commits: 2 } })).toBe('2 commits of yours');
    expect(value({ stages: stages({ development: 'running' }) })).toBe('Editing');
    expect(value({})).toBe('');
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
      { label: 'Merge', state: 'todo' },
    ]);
    expect(strip.ci).toBe(0.5);
    const ready = deliveryStrip(
      open({ ship: { ...PR_OPEN, all_green: true, ci: { state: 'pass', done: 6, total: 6 } } }),
    );
    expect(ready.steps.at(-1)).toEqual({ label: 'Merge', state: 'ready' });
    expect(ready.ci).toBeNull();
    const closed = deliveryStrip(open({ ship: { ...PR_OPEN, pr_state: 'closed' } }));
    expect(closed.steps[3]).toEqual({ label: 'PR', state: 'fail' });
    expect(deliveryStrip(open({ ship: { ...PR_OPEN, pr_state: null } })).steps.at(-1)?.state).toBe(
      'todo',
    );
  });

  it('R-5: draws the High Table seats and chief with its value, and leaves a skipped table out', () => {
    expect(tableStrip(open({ table: ord501Table('seated') }))).toMatchObject({
      chief: 'waiting',
      value: 'Seated',
    });
    const writing = tableStrip(open({ table: ord501Table('landing') }));
    expect(writing.value).toBe('3 of 7 notes');
    expect(writing.seats?.map((seat) => seat.label)).toEqual([
      'PO',
      'AA',
      'UF',
      'QA',
      'SA',
      'DE',
      'PA',
    ]);
    expect(writing.seats?.[0]).toEqual({ label: 'PO', state: 'done' });
    expect(writing.seats?.[1]).toEqual({ label: 'AA', state: 'writing' });
    expect(tableStrip(open({ table: ord501Table('chief') }))).toMatchObject({
      chief: 'ruling',
      value: 'Chief is ruling',
    });
    expect(
      tableStrip(
        open({ table: ord501Table('ruled'), decisions: { pending: [conflict], resolved: 0 } }),
      ),
    ).toMatchObject({ chief: 'needs', value: 'Needs answers' });
    expect(tableStrip(open({ table: ord501Table('ruled') }))).toMatchObject({
      chief: 'done',
      value: 'Chief ruled',
    });
    expect(
      tableStrip(
        open({ table: ord501Table('frozen'), stages: stages({ specification: 'complete' }) }),
      ),
    ).toMatchObject({ value: 'Spec approved' });
    const late = ord501Table('frozen') as { seats: Raw[] };
    late.seats[0] = { ...late.seats[0], late: true };
    expect(tableStrip(open({ table: late })).seats?.[0]).toEqual({ label: 'PO', state: 'late' });
    expect(
      tableStrip(open({ table: { ...ord482Table('ruled'), skipped: true } })).seats,
    ).toBeNull();
    expect(tableStrip(open({ lane: 'fast', table: ord501Table('ruled') })).seats).toBeNull();
    expect(tableStrip(open())).toEqual({ seats: null, chief: 'waiting', value: '' });
  });

  it('says the headline, the stage value and each section value in the strip alt', () => {
    const feature = band({ snapshot: parse(FAST_ORD_490) });
    expect(feature).toMatchObject({
      kind: 'feature',
      alt: 'Building. Stage Build. Delivery Editing.',
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

  it('closes for the session or hides, and says Needs you when something waits', () => {
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
  const full = ['Plan the change', 'Spec', 'Load rules', 'Build it', 'Review', 'Checks', 'Docs'];

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
      'paqad task list: Plan, Spec, Load rules, Build, Review, Checks, Docs. Start each item with that word, in this order. Items before Plan (read the ticket) and after Docs (open the PR) are fine.',
    );
    expect(TASK_LIST_SENTENCES.fast).toBe(
      'paqad task list: Plan, Build, Checks. Start each item with that word, in this order. Items before Plan and after Checks are fine.',
    );
  });
});

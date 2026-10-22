import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { describe, expect, it } from 'vitest';

import {
  ANSWER_TOAST,
  CLAIMS_LATER,
  COUNTING_WORDS,
  NOT_COUNTED_WORDS,
  RECORD_LATER,
  SHAPED_LATER,
  UNREADABLE,
  buildDesktopLedger,
  claimsView,
  costView,
  deliveryView,
  ledgerIsLive,
  ledgerSubtitle,
  ledgerTabs,
  localTime,
  recordView,
  tableView,
  trustGates,
  trustLight,
  trustView,
  workflowLedger,
  type DesktopLedgerInput,
} from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FULL_ORD_501,
  NOW,
  OTHER_WORKFLOW,
  costRecord,
  fileText,
  ord501Table,
  snapshot,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadHudSnapshot } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

type Raw = Record<string, unknown>;

const parse = (raw: Raw): PaqadHudSnapshot => parseSnapshot(fileText(raw))!;

const NUMBER = 702;
const PR = `PR #${NUMBER}`;
const ISSUE = String(600 + 25);

const SHIP0 = {
  commits: 0,
  commit_decision: null,
  merge_commit: null,
  push: null,
  pr: null,
  ci: null,
};

const PR_OPEN = {
  ...SHIP0,
  commits: 2,
  push: { state: 'pushed', branch: 'feat/seed' },
  pr: { number: NUMBER, url: 'https://example.test/pull/seven' },
  pr_url: 'https://example.test/pull/seven',
  pr_state: 'open',
  pr_title: 'Seed stage helpers',
  pr_additions: 412,
  pr_deletions: 87,
};

const OPEN: Raw = {
  ...FULL_ORD_501,
  stages: stages({}),
  table: null,
  gates: [],
  flags: [],
  claims: [],
  decisions: { pending: [], resolved: 0 },
  ship: SHIP0,
  verdict: null,
  gates_expected: ['change-completeness', 'code-tests-lint', 'mutation-testing'],
  delivery_plan: { commit: true, push: true, pr: true, ci: true, merge: true, reason: null },
};

const open = (over: Raw = {}) => parse(snapshot({ ...OPEN, ...over }));

const verdict = (kind: string, word: string, reasons: string[] = []) => ({
  schema: 'paqad.hud-verdict/1',
  kind,
  word,
  reasons,
});

const gate = (name: string, verdictWord: string, strength: string | null = 'deterministic') => ({
  name,
  required: verdictWord !== 'not-required',
  strength,
  verdict: verdictWord,
});

const conflict = { id: 'D-1', category: 'spec.expert_conflict', question: 'Email?' };

function ledger(over: Partial<DesktopLedgerInput> = {}) {
  return buildDesktopLedger({
    snapshot: open(),
    unbound: false,
    unavailable: false,
    tab: null,
    now: NOW,
    specText: null,
    ...over,
  });
}

describe('AC-19: the Ledger tabs', () => {
  it('are equal whole-number widths with full labels, Delivery for ships, High Table only when it sat', () => {
    const sat = ledgerTabs(open({ table: ord501Table('frozen') }), 'trust');
    expect(sat.map((tab) => [tab.id, tab.label, tab.width])).toEqual([
      ['trust', 'Trust', '20%'],
      ['table', 'High Table', '20%'],
      ['ships', 'Delivery', '20%'],
      ['record', 'Record', '20%'],
      ['cost', 'Cost', '20%'],
    ]);
    expect(sat.filter((tab) => tab.shown).map((tab) => tab.id)).toEqual(['trust']);
    const without = ledgerTabs(open(), 'table');
    expect(without.map((tab) => tab.label)).toEqual(['Trust', 'Delivery', 'Record', 'Cost']);
    expect(without.every((tab) => tab.width === '25%')).toBe(true);
    expect(without.find((tab) => tab.shown)?.id).toBe('trust');
    expect(ledgerTabs(open(), 'cost').find((tab) => tab.shown)?.id).toBe('cost');
    expect(sat.some((tab) => tab.label.includes('(shown)'))).toBe(false);
  });

  it('opens with the subtitle naming the change', () => {
    expect(ledgerSubtitle(open())).toBe('What happened, with proof  ·  ORD-501');
    expect(ledgerSubtitle(null)).toBe('What happened, with proof');
  });
});

describe('AC-20: the Trust tab', () => {
  it('lights by the Part B row, with its title and reason', () => {
    const light = (over: Raw) => trustLight(open(over), null, NOW);
    expect(trustLight(null, 'session-id', NOW)).toEqual({
      signal: 'attention',
      title: UNREADABLE,
      why: 'The session id could not be read.',
    });
    expect(trustLight(null, 'snapshot', NOW).why).toBe('The snapshot file is not valid.');
    expect(trustLight(parse(snapshot({ route: 'feature-development' })), null, NOW)).toEqual({
      signal: 'idle',
      title: 'Getting ready',
      why: 'The change opens when planning starts. Nothing is judged before that.',
    });
    expect(
      light({
        table: ord501Table('ruled'),
        decisions: { pending: [conflict, conflict], resolved: 0 },
      }),
    ).toEqual({
      signal: 'attention',
      title: 'Waiting for your answers',
      why: 'The chief ruled "needs answers". The spec freezes once you answer the 2 questions.',
    });
    expect(light({ decisions: { pending: [conflict], resolved: 0 } }).why).toBe(
      '1 decision needs your answer before work goes on.',
    );
    expect(light({ decisions: { pending: [conflict, conflict], resolved: 0 } }).why).toBe(
      '2 decisions need your answer before work goes on.',
    );
    expect(light({ last_block: { text: 'x', title: 'No React.FC' } }).signal).toBe('idle');
    const waiting = (waitingOn: 'question' | 'permission') =>
      trustLight(open({}), null, NOW, { ...IDLE_LIVE, turnId: 't', waitingOn });
    expect(waiting('question')).toEqual({
      signal: 'attention',
      title: 'Waiting for your answer',
      why: 'Claude asked you a question. Work goes on once you answer it.',
    });
    expect(waiting('permission').title).toBe('Waiting for your permission');
    expect(light({ ship: { ...PR_OPEN, merged: true, pr_state: 'merged' } })).toEqual({
      signal: 'pass',
      title: 'Merged',
      why: `${PR} is merged.`,
    });
    expect(light({ ship: { ...PR_OPEN, pr_state: 'closed' } }).why).toBe(
      `${PR} was closed without a merge.`,
    );
    expect(light({ ship: { ...PR_OPEN, ci: { state: 'fail', done: 6, total: 6 } } })).toEqual({
      signal: 'fail',
      title: 'CI failed',
      why: `CI failed on ${PR}. Fix it and push again.`,
    });
    expect(light({ ship: { ...SHIP0, push: { state: 'failed' } } })).toEqual({
      signal: 'fail',
      title: 'The push failed',
      why: null,
    });
    expect(
      light({
        verdict: verdict('fail', 'Needs your attention'),
        gates: [gate('code-tests-lint', 'fail')],
      }),
    ).toEqual({
      signal: 'fail',
      title: 'Needs your attention',
      why: 'Tests, types or lint failed. Fix it and run the checks again.',
    });
    expect(light({ verdict: verdict('inconclusive', 'Inconclusive', ['a', 'b']) })).toEqual({
      signal: 'caution',
      title: 'Inconclusive',
      why: 'a; b',
    });
    expect(light({ verdict: verdict('inconclusive', 'Inconclusive') }).why).toBeNull();
    expect(
      light({
        verdict: verdict('pass', 'Safe to merge'),
        ship: { ...SHIP0, commit_decision: 'decline' },
      }),
    ).toMatchObject({ signal: 'pass', title: 'Checks passed' });
    expect(light({ stages: stages({ development: 'running' }) })).toEqual({
      signal: 'idle',
      title: 'Not judged yet',
      why: 'Gates are judged after Build, Review and Checks. Nothing reads as a pass before that.',
    });
  });

  it('counts the gates that passed against the required ones when safe to merge', () => {
    const safe = open({
      verdict: verdict('pass', 'Safe to merge'),
      gates: [gate('change-completeness', 'pass'), gate('code-tests-lint', 'pass')],
    });
    expect(trustLight(safe, null, NOW)).toEqual({
      signal: 'pass',
      title: 'Safe to merge',
      why: '2 of 2 required gates pass. 1 gate was not required for this change and is not counted.',
    });
    const all = open({
      verdict: verdict('pass', 'Safe to merge'),
      gates: [
        gate('change-completeness', 'pass'),
        gate('code-tests-lint', 'pass'),
        gate('mutation-testing', 'not-required'),
        gate('duplication', 'not-required'),
      ],
    });
    expect(trustLight(all, null, NOW).why).toBe(
      '2 of 2 required gates pass. 2 gates were not required for this change and are not counted.',
    );
    const clean = open({
      verdict: verdict('pass', 'Safe to merge'),
      gates_expected: ['code-tests-lint'],
      gates: [gate('code-tests-lint', 'pass')],
    });
    expect(trustLight(clean, null, NOW).why).toBe('1 of 1 required gates pass.');
  });

  it('R-7: lists every expected gate, overlays the judged ones, and sorts required first', () => {
    const before = trustGates(open());
    expect(before.map((entry) => [entry.name, entry.required, entry.word])).toEqual([
      ['change-completeness', true, 'Not judged yet'],
      ['code-tests-lint', true, 'Not judged yet'],
      ['mutation-testing', true, 'Not judged yet'],
    ]);
    expect(before[0]).toMatchObject({
      words: 'Nothing left half done',
      how: 'How it is judged is not recorded',
      tone: 'dim',
      arc: { required: true, verdict: 'wait' },
    });
    const after = trustGates(
      open({
        verdict: verdict('fail', 'Needs your attention'),
        gates: [
          gate('code-tests-lint', 'fail'),
          gate('spec-review', 'pass', 'llm-judged'),
          gate('custom-gate', 'inconclusive', null),
          gate('ac-test-mapping', 'did-not-run'),
        ],
      }),
    );
    expect(after.map((entry) => [entry.name, entry.required, entry.word, entry.tone])).toEqual([
      ['code-tests-lint', true, 'Fail', 'fail'],
      ['spec-review', true, 'Pass', 'pass'],
      ['custom-gate', true, 'Inconclusive', 'cau'],
      ['ac-test-mapping', true, 'Did not run', 'cau'],
      ['change-completeness', false, 'Not required', 'dim'],
      ['mutation-testing', false, 'Not required', 'dim'],
    ]);
    expect(after.map((entry) => entry.words)).toEqual([
      'Tests, types and lint pass',
      'The spec was reviewed',
      'custom-gate',
      'Every criterion has a test',
      'Nothing left half done',
      'Tests catch real mutations',
    ]);
    expect(after.map((entry) => entry.how)).toEqual([
      'Checked by a script',
      'Judged by a reviewer agent',
      'How it is judged is not recorded',
      'Checked by a script',
      'How it is judged is not recorded',
      'How it is judged is not recorded',
    ]);
    const ring = trustView(
      open({
        verdict: verdict('fail', 'x'),
        gates: [gate('code-tests-lint', 'fail'), gate('change-completeness', 'pass')],
      }),
      NOW,
    ).ring;
    expect(ring).toEqual({
      marks: [
        { required: true, verdict: 'pass' },
        { required: true, verdict: 'fail' },
        { required: false, verdict: 'wait' },
      ],
      passed: 1,
      required: 2,
      alt: '1 of 2 required gates pass',
    });
  });

  it('R-8: lists at most four claims with their proving tests, then how many more', () => {
    const claim = (id: string, verdictWord: string) => ({
      kind: 'acceptance',
      id,
      label: `${id} holds`,
      test_id: verdictWord === 'pass' ? `tests/${id}.test.ts` : null,
      verdict: verdictWord,
    });
    const five = claimsView(
      open({
        claims: ['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5', 'AC-6'].map((id) => claim(id, 'pass')),
      }),
    );
    expect(five.rows).toHaveLength(4);
    expect(five.rows[0]).toEqual({
      key: 'AC-1',
      id: 'AC-1',
      label: 'AC-1 holds',
      sub: 'tests/AC-1.test.ts',
      word: 'Proven',
      tone: 'pass',
    });
    expect(five.more).toBe('+2 more, all proven');
    const mixed = claimsView(
      open({
        claims: [
          ...['AC-1', 'AC-2', 'AC-3', 'AC-4'].map((id) => claim(id, 'pass')),
          claim('AC-5', 'missing'),
        ],
      }),
    );
    expect(mixed.more).toBe('+1 more');
    const missing = claimsView(open({ claims: [claim('AC-1', 'missing')] }));
    expect(missing.rows[0]).toMatchObject({
      sub: 'No proving test recorded',
      word: 'Not proven',
      tone: 'dim',
    });
    expect(missing.more).toBeNull();
    const fix = claimsView(
      open({
        claims: [{ kind: 'fix-proof', label: 'Red only', test_id: 't', verdict: 'inconclusive' }],
      }),
    );
    expect(fix.rows[0]).toMatchObject({
      id: null,
      key: 'fix-proof-0',
      word: 'Not proven',
      tone: 'cau',
    });
    expect(claimsView(open())).toEqual({ rows: [], more: null, empty: CLAIMS_LATER });
    expect(claimsView(open({ stages: stages({ specification: 'complete' }) })).empty).toBe(
      'No claim recorded for this change.',
    );
  });

  it('lists the open flags', () => {
    expect(trustView(open({ flags: [{ id: 'f', text: 'one flag' }] }), NOW).flags).toEqual([
      { id: 'f', text: 'one flag' },
    ]);
    expect(trustView(parse(snapshot({ route: 'feature-development' })), NOW).flags).toEqual([]);
  });

  it('keeps a rule stop as history, not as a question for you', () => {
    const block = { text: 'x', rule: 'RL-13', file: 'src/x.ts' };
    expect(trustView(open({ last_block: block }), NOW).flags).toEqual([
      { id: 'rule-stop', text: 'A rule stopped an edit to src/x.ts.' },
    ]);
    expect(trustView(open({ last_block: { ...block, used: true } }), NOW).flags).toEqual([
      { id: 'rule-stop', text: 'A rule stopped an edit to src/x.ts. It was answered.' },
    ]);
    expect(trustView(open({ last_block: { text: 'x' } }), NOW).flags).toEqual([
      { id: 'rule-stop', text: 'A rule stopped an edit.' },
    ]);
  });
});

describe('AC-21: the High Table tab', () => {
  const SPEC = [
    '# Spec',
    '- FR-1: The start hook writes the brief',
    '- FR-2: Each stage reads its model',
    '- AC-1: Given x, then y',
    '- NFR-1: A large export stays fast',
    'Not a line',
  ].join('\n');

  it('draws the ring, the summary and the seats with their details', () => {
    const view = tableView(open({ table: ord501Table('landing') }), null)!;
    expect(view.ring.slice(0, 2)).toEqual([
      { label: 'PO', state: 'done', findings: 2 },
      { label: 'AA', state: 'writing', findings: null },
    ]);
    expect(view.alt).toBe('3 of 7 notes landed');
    expect(view.summary).toEqual({
      notes: '3 of 7 notes',
      findings: '5 findings',
      picked: '3 picked for this change',
      standing: '4 always at the table',
    });
    expect(view.seats[0]).toEqual({
      role: 'product-owner',
      initials: 'PO',
      words: 'Product owner',
      picked: false,
      word: '2m 05s · 2 findings',
      tone: 'dim',
      details: [
        'standing expert (always at the table)',
        'Note: ~900 tokens of its 4K budget',
        'Run: 21.4K tokens (exact, from Claude Code)',
        'Track record: on 6 earlier changes, changed the spec on 4, had nothing to add on 1, about 2,300 tokens each.',
      ],
    });
    expect(view.seats[1]).toMatchObject({
      word: 'writing…',
      tone: 'acc',
      details: ['standing expert (always at the table)'],
    });
    expect(view.seats[4]).toMatchObject({ initials: 'SA', picked: true });
    const seated = tableView(open({ table: ord501Table('seated') }), null)!;
    expect(seated.seats[0]).toMatchObject({ word: 'seated', tone: 'dim' });
    expect(seated.chiefView.light).toEqual({
      signal: 'idle',
      title: 'Listening',
      why: 'Rules when all 7 notes have landed',
    });
  });

  it('shows the chief by its state, with the conflicts and the chat prompt while it needs answers', () => {
    const needs = tableView(
      open({
        table: ord501Table('ruled'),
        decisions: { pending: [conflict, conflict], resolved: 0 },
      }),
      null,
    )!;
    expect(needs.chief).toBe('needs');
    expect(needs.chiefView.light).toEqual({
      signal: 'attention',
      title: 'Needs your answers',
      why: 'Ruled in 2m 00s · 28.5K tokens',
    });
    expect(needs.chiefView.conflicts[0]?.target).toBe('Customer email in the export');
    expect(needs.chiefView.answer).toBe('Walk me through the 2 open decisions');
    expect(ANSWER_TOAST).toBe(
      'Type your answers in the chat. The questions are in the High Table tab.',
    );
    const approved = tableView(open({ table: ord501Table('frozen') }), null)!;
    expect(approved.chiefView).toMatchObject({ state: 'done', conflicts: [], answer: null });
    expect(approved.chiefView.light.title).toBe('Approved');
    expect(approved.chiefView.light.why).toMatch(/^After your \d+ answers? · 28.5K tokens$/);
    const ruling = tableView(open({ table: ord501Table('chief') }), null)!;
    expect(ruling.chiefView.light).toEqual({
      signal: 'accent',
      title: 'Ruling',
      why: 'The chief architect is reading the notes.',
    });
  });

  it('credits each spec line to the experts who shaped it, after the freeze', () => {
    const frozen = tableView(open({ table: ord501Table('frozen') }), SPEC)!;
    expect(frozen.shaped.rows.length).toBeGreaterThan(0);
    const first = frozen.shaped.rows[0]!;
    expect(first.who).toMatch(/^[A-Z]{2}( · [A-Z]{2})*$/);
    expect(frozen.shaped.empty).toBeNull();
    expect(frozen.shaped.total).toBe('2 of 3 spec lines came from an expert note.');
    const fr1 = frozen.shaped.rows.find((row) => row.id === 'FR-1');
    if (fr1) expect(fr1.line).toBe('The start hook writes the brief');
    expect(frozen.shaped.rows.find((row) => row.id === 'NFR-1')?.line).toBe(
      'A large export stays fast',
    );
    expect(frozen.shaped.rows.find((row) => row.id === 'INV-1')?.line).toBe('INV-1');
    expect(tableView(open({ table: ord501Table('frozen') }), null)!.shaped.total).toBeNull();
    const whole = [
      ...Array.from({ length: 8 }, (_, index) => `- FR-${index + 1}: Line ${index + 1}`),
      '- FR-1: The same line again',
      '- AC-1: A criterion',
      '- NFR-1: Not counted',
      '- INV-1: Not counted',
    ].join('\n');
    expect(tableView(open({ table: ord501Table('frozen') }), whole)!.shaped.total).toBe(
      '8 of 9 spec lines came from an expert note.',
    );
    expect(tableView(open({ table: ord501Table('ruled') }), SPEC)!.shaped).toEqual({
      rows: [],
      total: null,
      empty: SHAPED_LATER,
    });
    expect(tableView(open(), SPEC)).toBeNull();
  });
});

describe('AC-22: the Delivery tab', () => {
  it('draws one block per step of the plan, with commits own and inherited, PR size, CI jobs and the PR link', () => {
    const view = deliveryView(
      open({
        stages: stages({ development: 'complete' }),
        ship: {
          ...PR_OPEN,
          files_changed: 14,
          all_green: true,
          commit_list: [
            { sha: 'a1c9e2f0aa', subject: 'Seed stage helpers', own: true },
            { sha: '64e4c85bbb', subject: 'Upgrade changes from main', own: false },
          ],
          ci: {
            state: 'pass',
            done: 2,
            total: 2,
            jobs: [
              {
                name: 'lint',
                conclusion: 'SUCCESS',
                started_at: '2026-10-18T08:50:00.000Z',
                completed_at: '2026-10-18T08:50:38.000Z',
              },
              {
                name: 'unit',
                conclusion: 'SUCCESS',
                started_at: '2026-10-18T08:50:00.000Z',
                completed_at: '2026-10-18T08:51:52.000Z',
              },
            ],
          },
        },
      }),
    );
    expect(view.empty).toBeNull();
    expect(view.blocks.map((block) => [block.label, block.title, block.sub, block.right])).toEqual([
      ['Edit', 'Edit', '14 files changed by this change', null],
      ['Commit', 'Commits', '2 by this change', null],
      ['Push', 'Push', 'feat/seed on origin', null],
      ['PR', 'Pull request', `#${NUMBER} Seed stage helpers`, '+412 −87'],
      ['CI', 'CI', 'All 2 checks passed in 1m 52s', null],
      ['Merge', 'Merge', 'Everything is green. The merge is yours.', null],
    ]);
    expect(view.blocks[1]!.commits).toEqual([
      { sha: 'a1c9e2f', subject: 'Seed stage helpers', own: true },
      { sha: '64e4c85', subject: 'Upgrade changes from main', own: false },
    ]);
    expect(view.blocks[4]!.jobs).toEqual([
      { name: 'lint', time: '38s', tone: 'dim', share: 1 },
      { name: 'unit', time: '1m 52s', tone: 'dim', share: 1 },
    ]);
    expect(view.blocks[5]!.link).toEqual({
      href: 'https://example.test/pull/seven',
      text: `Open ${PR}`,
    });
  });

  it('says what has not happened yet, and runs the CI meters by job state', () => {
    const early = deliveryView(open());
    expect(early.blocks.map((block) => block.sub)).toEqual([
      'Code changes start after the spec is frozen.',
      'None of yours yet',
      'After Checks and Docs',
      'Opened after the push',
      'Runs on the pull request',
      'The merge is always yours. paqad never merges.',
    ]);
    expect(early.blocks.every((block) => !block.reached)).toBe(true);
    const running = deliveryView(
      open({
        stages: stages({ development: 'running' }),
        ship: {
          ...PR_OPEN,
          pr_additions: null,
          ci: {
            state: 'pending',
            done: 1,
            total: 4,
            jobs: [
              { name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' },
              { name: 'b', status: 'QUEUED' },
              { name: 'c', status: 'IN_PROGRESS' },
              { name: 'd', conclusion: 'SUCCESS' },
            ],
          },
        },
      }),
    );
    expect(running.blocks[0]!.sub).toBeNull();
    expect(running.blocks[3]!.right).toBeNull();
    expect(running.blocks[4]).toMatchObject({ sub: '1 of 4 checks green', ci: 0.25 });
    expect(running.blocks[4]!.jobs).toEqual([
      { name: 'a', time: 'failed', tone: 'fail', share: 1 },
      { name: 'b', time: 'queued', tone: 'dim', share: 0 },
      { name: 'c', time: 'running', tone: 'dim', share: null },
      { name: 'd', time: 'done', tone: 'dim', share: 1 },
    ]);
    const failed = deliveryView(open({ ship: { ...SHIP0, push: { state: 'failed' } } }));
    expect(failed.blocks[2]!.sub).toBe('The push failed');
    const merged = deliveryView(
      open({
        ship: {
          ...PR_OPEN,
          merged: true,
          pr_state: 'merged',
          ci: { state: 'pass', done: 1, total: 1 },
        },
      }),
    );
    expect(merged.blocks.at(-1)!.sub).toBe(`${PR} is merged.`);
    expect(merged.blocks[4]!.sub).toBe('All 1 checks passed');
    expect(deliveryView(parse(snapshot({ route: 'feature-development' })))).toEqual({
      blocks: [],
      empty: 'Nothing to deliver yet.',
    });
    expect(
      deliveryView(
        open({
          delivery_plan: {
            commit: false,
            push: false,
            pr: false,
            ci: false,
            merge: false,
            reason: 'x',
          },
        }),
      ).blocks.map((block) => block.label),
    ).toEqual(['Edit']);
  });
});

describe('AC-23: the Record and Cost tabs', () => {
  const at = (time: string) => `2026-10-18T${time}:00.000Z`;
  const entry = (time: string, kind: string, fields: Raw = {}) => ({
    at: at(time),
    kind,
    stage: null,
    note: null,
    ...fields,
  });

  it('says each event of the change in words, at local time', () => {
    const view = recordView(
      open({
        timeline: [
          entry('08:00', 'open', { issue: ISSUE, title: 'seed stage helpers', lane: 'full' }),
          entry('08:01', 'stage_start', { stage: 'planning', own_agent: true }),
          entry('08:02', 'stage_end', { stage: 'planning', duration_ms: 101000 }),
          entry('08:03', 'stage_start', { stage: 'development' }),
          entry('08:04', 'stage_end', { stage: 'review' }),
          entry('08:05', 'rules_loaded', { count: 20 }),
          entry('08:06', 'table_seated', { picked: 3, standing: 4 }),
          entry('08:07', 'notes_landed', { count: 7, findings: 55 }),
          entry('08:08', 'chief_ruled', { duration_ms: 95000, verdict: 'needs answers' }),
          entry('08:09', 'decisions_opened', { count: 1 }),
          entry('08:10', 'decisions_answered', { count: 2 }),
          entry('08:11', 'spec_frozen', { requirements: 12, criteria: 9 }),
          entry('08:12', 'commit', { sha: 'a1c9e2f', subject: 'stage-agent-start hook' }),
          entry('08:13', 'push', { state: 'pushed', count: 2 }),
          entry('08:14', 'push', { state: 'failed' }),
          entry('08:15', 'pr_opened', { number: NUMBER }),
          entry('08:16', 'ci', { state: 'pass', count: 6 }),
          entry('08:17', 'ci', { state: 'fail' }),
          entry('08:18', 'open', { note: 'reopened via resume' }),
          entry('08:19', 'close', { note: 'abandoned' }),
          entry('08:20', 'something_new'),
        ],
      }),
    );
    expect(view.empty).toBeNull();
    expect(view.rows.map((row) => row.text)).toEqual([
      `Change opened: #${ISSUE} seed stage helpers, full lane`,
      'Plan started in its own agent',
      'Plan done in 1m 41s',
      'Build started',
      'Review done',
      'Rules loaded: 20 apply',
      'High Table seated: 3 picked, 4 standing',
      'All 7 notes landed, 55 findings',
      'Chief ruled in 1m 35s: needs answers',
      '1 decision opened for you',
      'You answered 2 decisions',
      'Spec frozen: 12 requirements, 9 criteria',
      'Commit a1c9e: stage-agent-start hook',
      'Pushed 2 commits',
      'The push failed',
      `${PR} opened`,
      'CI green on all 6 jobs',
      'CI failed',
      'Reopened: reopened via resume',
      'Closed: abandoned',
    ]);
    expect(view.rows[0]!.time).toBe(localTime(at('08:00')));
    const local = new Date(Date.parse(at('08:00')));
    expect(localTime(at('08:00'))).toBe(
      `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
    );
  });

  it('says a bare change opened, and waits for the change before it records anything', () => {
    expect(
      recordView(
        open({
          timeline: [
            entry('08:00', 'open'),
            entry('08:01', 'close'),
            entry('08:02', 'chief_ruled'),
          ],
        }),
      ).rows.map((row) => row.text),
    ).toEqual(['Change opened', 'Closed', 'Chief ruled']);
    expect(
      recordView(open({ timeline: [entry('08:00', 'open', { issue: 'ORD-501' })] })).rows[0]!.text,
    ).toBe('Change opened: ORD-501');
    expect(
      recordView(open({ timeline: [entry('08:00', 'pr_opened')], ship: PR_OPEN })).rows[0]!.text,
    ).toBe(`${PR} opened`);
    expect(recordView(open())).toEqual({ rows: [], empty: RECORD_LATER });
    expect(
      recordView(
        parse(snapshot({ route: 'feature-development', timeline: [entry('08:00', 'open')] })),
      ),
    ).toEqual({
      rows: [],
      empty: RECORD_LATER,
    });
  });

  it('draws the total, the estimate, the scope, the stage and High Table meters and what is not counted', () => {
    const view = costView(open({ cost: costRecord(), table: ord501Table('frozen') }))!;
    expect(view.total).toBe('1.3M tokens');
    expect(view.money).toBe('~$4.60 estimate at API prices · 2026-10-19 prices');
    expect(view.note).toContain(
      "Counted from the change's first row to its seal, this change only.",
    );
    expect(view.live).toBeNull();
    expect(view.stages.length).toBeGreaterThan(0);
    expect(Math.max(...view.stages.map((meter) => meter.share))).toBe(1);
    expect(view.stages.every((meter) => meter.share >= 0 && meter.share <= 1)).toBe(true);
    expect(view.table[0]).toMatchObject({ key: 'chief', name: 'Chief architect' });
    expect(view.table.length).toBeGreaterThan(1);
    expect(view.notCounted).toBe(NOT_COUNTED_WORDS);
    const live = costView(open({ cost: costRecord({ live: true, scope: 'whole-session' }) }))!;
    expect(live.live).toBe(COUNTING_WORDS);
    expect(live.note).toContain("Whole session: paqad could not split this session's turns");
    expect(live.table).toEqual([]);
    const unpriced = costView(
      open({ cost: costRecord({ usd: null, unpriced_models: ['claude-future-9'] }) }),
    )!;
    expect(unpriced.money).toBe('No price for claude-future-9');
    expect(costView(open({ cost: costRecord({ usd: null, unpriced_models: [] }) }))!.money).toBe(
      'No money figure',
    );
    const named = costView(
      open({
        cost: costRecord({
          by_stage: [
            {
              stage: 'orchestrator',
              tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
              usd: null,
            },
            {
              stage: 'specification',
              tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
              usd: 0,
            },
          ],
          by_expert: [],
          chief: null,
        }),
        table: ord501Table('frozen'),
      }),
    )!;
    expect(named.stages.map((meter) => [meter.name, meter.share, meter.right])).toEqual([
      ['Between stages', 0, '0'],
      ['Spec, with the High Table', 0, '0 · $0.00'],
    ]);
    expect(named.table).toEqual([]);
    expect(costView(open())).toBeNull();
  });
});

describe('AC-24: other workflows get the cost-only Ledger', () => {
  it('draws one light and the workflow cost, with no tabs', () => {
    const priced = parse(
      snapshot({
        ...OTHER_WORKFLOW,
        workflow: {
          name: 'project-question',
          started_at: null,
          tokens: 84000,
          usd: 0.05,
          unpriced: [],
        },
      }),
    );
    expect(ledger({ snapshot: priced })).toEqual({
      kind: 'workflow',
      view: {
        light: {
          signal: 'accent',
          title: 'Question',
          why: 'No change in this session, so there is nothing to prove. paqad shows what this workflow cost.',
        },
        total: '84K tokens',
        money: '~$0.05 estimate at API prices',
        note: 'Counted from when this question started in this session. Nothing from other sessions or earlier changes.',
      },
    });
    expect(workflowLedger(parse(OTHER_WORKFLOW), 'project-question')).toMatchObject({
      total: 'counting',
      money: null,
    });
  });
});

describe('the Ledger frame', () => {
  it('reads unreadable, none, workflow or feature, on the shown tab', () => {
    expect(ledger({ snapshot: null, unbound: true })).toMatchObject({
      kind: 'unreadable',
      light: { title: UNREADABLE, why: 'The session id could not be read.' },
    });
    expect(ledger({ snapshot: null })).toEqual({ kind: 'none' });
    const feature = ledger({ tab: 'record', snapshot: open({ table: ord501Table('frozen') }) });
    expect(feature).toMatchObject({
      kind: 'feature',
      shown: 'record',
      subtitle: 'What happened, with proof  ·  ORD-501',
    });
    if (feature.kind !== 'feature') throw new Error('feature Ledger expected');
    expect(feature.table).not.toBeNull();
    expect(ledger()).toMatchObject({ kind: 'feature', shown: 'trust', table: null });
  });

  it('is live only while a seat writes, the chief rules or waits, or a delivery step runs', () => {
    expect(ledgerIsLive(ledger())).toBe(false);
    expect(ledgerIsLive(ledger({ snapshot: open({ table: ord501Table('writing') }) }))).toBe(true);
    expect(ledgerIsLive(ledger({ snapshot: open({ table: ord501Table('chief') }) }))).toBe(true);
    expect(
      ledgerIsLive(ledger({ snapshot: open({ stages: stages({ development: 'running' }) }) })),
    ).toBe(true);
    expect(ledgerIsLive(ledger({ snapshot: parse(OTHER_WORKFLOW) }))).toBe(false);
  });
});

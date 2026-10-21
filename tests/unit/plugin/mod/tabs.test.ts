import { describe, expect, it } from 'vitest';

import { runPaqadCommand } from '../../../../runtime/claude-plugin/mod/commands.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  SHORT_TAB_COLUMNS,
  buildPaneView,
  shownTab,
} from '../../../../runtime/claude-plugin/mod/pane.ts';
import type { TableLine } from '../../../../runtime/claude-plugin/mod/table.ts';
import {
  NO_GATES,
  NO_PLAN,
  NOTHING_PUSHED,
  NOT_JUDGED,
  NOT_JUDGED_WHY,
  gateRing,
  linesText,
  recordLines,
  requiredGates,
  trustLines,
} from '../../../../runtime/claude-plugin/mod/tabs.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  NOW,
  PAUSED,
  fileText,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

const parse = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw))!;
const text = (lines: readonly TableLine[]) => linesText(lines).split('\n');

const GATES = [
  { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
  { name: 'duplication', required: true, strength: 'deterministic', verdict: 'fail' },
  { name: 'mutation-testing', required: false, strength: 'deterministic', verdict: 'not-required' },
  { name: 'review-quality', required: true, strength: 'llm-judged', verdict: 'inconclusive' },
  { name: 'late-gate', required: true, strength: null, verdict: 'did-not-run' },
];

const PRESENT = (files: string[]) =>
  files.map((file) => ({ file, expectation: 'always', present: true }));

describe('the Trust tab', () => {
  it('groups the gates by strength, each with its verdict in words', () => {
    const lines = text(trustLines(parse({ ...FULL_ORD_501, gates: GATES })));
    expect(lines[0]).toBe('Verdict Safe to merge');
    expect(lines).toContain('Deterministic');
    expect(lines).toContain('  ● code-tests-lint  pass');
    expect(lines).toContain('  ✗ duplication  fail');
    expect(lines).toContain('  – mutation-testing  not required');
    expect(lines).toContain('Judged by a model');
    expect(lines).toContain('  ~ review-quality  inconclusive');
    expect(lines).toContain('Strength not recorded');
    expect(lines).toContain('  ○ late-gate  did not run');
    expect(lines.indexOf('Deterministic')).toBeLessThan(lines.indexOf('Judged by a model'));
  });

  it('counts only required gates in the ring', () => {
    const gates = parse({ ...FULL_ORD_501, gates: GATES }).gates;
    expect(requiredGates(gates).map((gate) => gate.name)).toEqual([
      'code-tests-lint',
      'duplication',
      'review-quality',
      'late-gate',
    ]);
    const ring = gateRing(gates);
    expect(ring.map((segment) => segment.text).join('')).toBe('Gates ●✗~○  1/4 required');
    expect(ring.filter((segment) => segment.tone).map((segment) => segment.tone)).toEqual([
      'good',
      'bad',
      'warn',
      'warn',
    ]);
  });

  it('shows each claim with its proving test, and the flags', () => {
    const lines = text(
      trustLines(
        parse({
          ...FULL_ORD_501,
          claims: [
            {
              kind: 'fix-proof',
              proof: 'red-green',
              label: 'fails before the fix, passes after',
              verdict: 'pass',
              test_id: 'tests/orders.test.ts > keeps the phone',
            },
            {
              kind: 'fix-proof',
              proof: 'none',
              label: 'no proof recorded',
              verdict: 'inconclusive',
              test_id: null,
            },
          ],
        }),
      ),
    );
    expect(lines).toContain('Claims and the tests that prove them');
    expect(lines).toContain(
      '  Fix proof: fails before the fix, passes after  passed  proving test tests/orders.test.ts > keeps the phone',
    );
    expect(lines).toContain(
      '  Fix proof: no proof recorded  Inconclusive  no proving test recorded',
    );
    expect(lines).toContain('Flags');
    expect(lines).toContain('  flag 1 near-copy of existing code is open.');
  });

  it('AC-31: shows each proof state with its one fixed label, and none and not-reproduced read Inconclusive', () => {
    const states: Array<[string, string, string]> = [
      ['none', 'no proof recorded', 'Inconclusive'],
      ['red', 'fails before the fix, no green yet', 'Inconclusive'],
      ['red-green', 'fails before the fix, passes after', 'passed'],
      ['green-only', 'passes, but never shown failing before the fix', 'Inconclusive'],
      [
        'not-reproduced',
        'passed before the fix, so it never reproduced the problem',
        'Inconclusive',
      ],
      ['held', 'held: the fix broke a check that passed before', 'Inconclusive'],
    ];
    for (const [proof, label, word] of states) {
      const lines = text(
        trustLines(
          parse({
            ...FULL_ORD_501,
            claims: [
              {
                kind: 'fix-proof',
                proof,
                label,
                verdict: proof === 'red-green' ? 'pass' : 'inconclusive',
                test_id: null,
              },
            ],
          }),
        ),
      );
      expect(lines, proof).toContain(`  Fix proof: ${label}  ${word}  no proving test recorded`);
      if (proof === 'none' || proof === 'not-reproduced') {
        expect(lines.join('\n'), proof).not.toContain('passed  ');
      }
    }
  });

  it('names its empty state when no gate was judged', () => {
    expect(text(trustLines(parse({ ...FAST_ORD_490 })))).toEqual([
      NOT_JUDGED,
      NOT_JUDGED_WHY,
      NO_GATES,
      'Claims and the tests that prove them',
      '  No claim recorded for this change.',
      'Flags',
      '  No flag is open.',
    ]);
    expect(text(trustLines(null))).toEqual([NO_GATES]);
    expect(text(trustLines(parse(PAUSED)))).toEqual(['No change is in progress.']);
  });
});

describe('the Record tab', () => {
  it('shows the plan, decisions, rules and receipt', () => {
    const lines = text(
      recordLines(
        parse({
          ...FULL_ORD_501,
          evidence_expected: PRESENT(['plan.json']),
          decisions: {
            pending: [{ id: 'D-1', category: 'fix.proof_method', question: 'How to prove it?' }],
            resolved: 4,
          },
        }),
      ),
    );
    expect(lines).toEqual([
      'Plan         recorded in plan.json',
      'Decisions    1 waiting, 4 resolved',
      '  D-1 (fix.proof_method) How to prove it?',
      'Rules        12 apply, loaded',
      'Receipt      written, see /paqad receipt',
    ]);
  });

  it('names its empty state when no plan is recorded', () => {
    const lines = text(recordLines(parse({ ...FAST_ORD_490, rules: { recorded: false } })));
    expect(lines).toEqual([
      NO_PLAN,
      'Decisions    0 resolved',
      'Rules        not loaded yet',
      'Receipt      not yet, written at the end of a turn',
    ]);
    expect(text(recordLines(null))).toEqual([NO_PLAN]);
  });
});

describe('which tab the Ledger opens on (FR-55, AC-39)', () => {
  const verdictLanded = parse({ ...FULL_ORD_501 });

  it('opens on Trust when nobody picked a tab', () => {
    expect(shownTab(null)).toBe('trust');
    expect(shownTab('nope')).toBe('trust');
    const view = buildPaneView(verdictLanded, null);
    expect(view.subtitle).toBe('what happened, with proof');
    expect(view.tabs.find((tab) => tab.selected)?.id).toBe('trust');
  });

  it('never overrides a tab the person picked', () => {
    expect(shownTab('record')).toBe('record');
    const view = buildPaneView(verdictLanded, 'record');
    expect(view.tabs.find((tab) => tab.selected)?.id).toBe('record');
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.lines).toEqual([]);
  });

  it('orders the tabs Trust, High Table, Ships, Record, Cost and shortens them below 80 columns', () => {
    const wide = buildPaneView(verdictLanded, null, { columns: SHORT_TAB_COLUMNS });
    expect(wide.tabs.map((tab) => tab.label)).toEqual([
      'Trust',
      'High Table',
      'Ships',
      'Record',
      'Cost',
    ]);
    const narrow = buildPaneView(verdictLanded, null, { columns: SHORT_TAB_COLUMNS - 1 });
    expect(narrow.tabs.map((tab) => tab.label)).toEqual(['Trust', 'Table', 'Ships', 'Rec', 'Cost']);
  });
});

describe('/paqad trust, ships and record', () => {
  const run = (args: string, raw: Record<string, unknown>) =>
    runPaqadCommand({
      args,
      standDown: null,
      snapshot: parse(raw),
      receipt: null,
      now: NOW,
    }).text;

  it('print the same lines as the tabs', () => {
    expect(run('trust', FAST_ORD_490)).toContain(NO_GATES);
    expect(run('trust', FAST_ORD_490).split('\n')[0]).toBe(NOT_JUDGED);
    expect(run('ships', snapshot({ active: true, ship: null }))).toBe(NOTHING_PUSHED);
    expect(run('record', { ...FULL_ORD_501, evidence_expected: PRESENT(['plan.json']) })).toContain(
      'Plan         recorded in plan.json',
    );
  });
});

describe('the Record timeline (FR-61, AC-48)', () => {
  it('lists the change rows in words, with an abandoned close and its note', () => {
    const lines = text(
      recordLines(
        parse({
          ...FULL_ORD_501,
          timeline: [
            { at: '2026-10-01T09:00:00.000Z', kind: 'open', stage: null, note: null },
            { at: '2026-10-01T09:05:00.000Z', kind: 'stage_start', stage: 'planning', note: null },
            { at: '2026-10-01T09:09:00.000Z', kind: 'stage_end', stage: 'planning', note: null },
            {
              at: '2026-10-03T10:00:00.000Z',
              kind: 'close',
              stage: null,
              note: 'abandoned: branch gone, no row for 24h',
            },
            {
              at: '2026-10-04T08:00:00.000Z',
              kind: 'open',
              stage: null,
              note: 'reopened via resume',
            },
            { at: '2026-10-04T08:01:00.000Z', kind: 'stage_end', stage: null, note: 'held' },
            { at: '2026-10-04T08:02:00.000Z', kind: 'stage_start', stage: 'custom', note: null },
          ],
        }),
      ),
    );
    expect(lines.slice(lines.indexOf('Timeline'))).toEqual([
      'Timeline',
      '  09:00  Change opened',
      '  09:05  Plan started',
      '  09:09  Plan ended',
      '  10:00  Closed: abandoned: branch gone, no row for 24h',
      '  08:00  Reopened: reopened via resume',
      '  08:01  A stage ended: held',
      '  08:02  custom started',
    ]);
    expect(text(recordLines(parse(FULL_ORD_501)))).not.toContain('Timeline');
  });
});

describe('AC-30: the terminal tabs read as before when the snapshot carries the Desktop data', () => {
  const desktopData = {
    claims: [
      { kind: 'acceptance', id: 'AC-1', label: 'binds', test_id: 't.test.ts', verdict: 'pass' },
    ],
    timeline: [
      { at: '2026-10-18T09:00:00.000Z', kind: 'open', stage: null, note: null, title: 'csv' },
      { at: '2026-10-18T09:03:00.000Z', kind: 'rules_loaded', stage: null, note: null, count: 3 },
      { at: '2026-10-18T09:05:00.000Z', kind: 'commit', stage: null, note: null, sha: 'a1c9e2f' },
    ],
  };

  it('keeps acceptance claims and Record events off the terminal Trust and Record lines', () => {
    const plain = parse({ ...FULL_ORD_501, timeline: [desktopData.timeline[0]] });
    const rich = parse({ ...FULL_ORD_501, ...desktopData });
    expect(text(trustLines(rich))).toEqual(text(trustLines(plain)));
    expect(text(recordLines(rich))).toEqual(text(recordLines(plain)));
    expect(text(recordLines(rich)).slice(-2)).toEqual(['Timeline', '  09:00  Change opened']);
  });
});

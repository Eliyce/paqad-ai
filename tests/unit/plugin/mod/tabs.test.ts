import { describe, expect, it } from 'vitest';

import { ticketRef } from '../../../shared/ticket-ref.js';
import { runPaqadCommand } from '../../../../runtime/claude-plugin/mod/commands.ts';
import { parseSnapshot, shipSteps } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  SHORT_TAB_COLUMNS,
  autoTab,
  buildPaneView,
  shownTab,
} from '../../../../runtime/claude-plugin/mod/pane.ts';
import type { TableLine } from '../../../../runtime/claude-plugin/mod/table.ts';
import {
  NO_GATES,
  NO_PLAN,
  NOTHING_PUSHED,
  deliveryInProgress,
  gateRing,
  linesText,
  recordLines,
  requiredGates,
  shipsLines,
  trustLines,
} from '../../../../runtime/claude-plugin/mod/tabs.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  NOW,
  PAUSED,
  fileText,
  ord501At,
  snapshot,
  stages,
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

const SHIPPING = {
  commits: 76,
  commit_decision: 'commit',
  merge_commit: null,
  push: { state: 'pushed', branch: 'feat/ORD-501-csv-export', sha: 'abc', at: 'x' },
  pr: { number: 12, url: 'https://example.test/pull/12', draft: true, at: 'x' },
  ci: { sha: 'abc', state: 'pending', done: 3, total: 7, reason: null, source: 'deliver', at: 'x' },
  own: { count: 3, tickets: ['ORD-501'], merges: 0, untagged: 0 },
  inherited: { count: 73, tickets: ['ORD-470', 'ORD-471'], merges: 2, untagged: 5 },
};

const PRESENT = (files: string[]) =>
  files.map((file) => ({ file, expectation: 'always', present: true }));

describe('the Trust tab', () => {
  it('groups the gates by strength, each with its verdict in words', () => {
    const lines = text(trustLines(parse({ ...FULL_ORD_501, gates: GATES })));
    expect(lines[0]).toBe('Verdict Safe to merge');
    expect(lines).toContain('Deterministic');
    expect(lines).toContain('  ● code-tests-lint  passed');
    expect(lines).toContain('  ✗ duplication  failed');
    expect(lines).toContain('  - mutation-testing  not required');
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
    expect(ring.map((segment) => segment.text).join('')).toBe('Gates ●✗~○  1 of 4 required passed');
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
    expect(lines).toContain('Claims');
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
    expect(text(trustLines(parse({ ...FAST_ORD_490 })))).toEqual([NO_GATES]);
    expect(text(trustLines(null))).toEqual([NO_GATES]);
    expect(text(trustLines(parse(PAUSED)))).toEqual(['No change is in progress.']);
  });
});

describe('the Ships tab', () => {
  it('shows own and riding-along commits, PR, a partial CI, merge and rollback', () => {
    const lines = text(shipsLines(parse({ ...FULL_ORD_501, ship: SHIPPING })));
    expect(lines).toEqual([
      'Own          3 commits, from ORD-501',
      'Riding along 73 commits, from ORD-470, ORD-471, 2 merges, 5 with no ticket',
      'Push         pushed to feat/ORD-501-csv-export',
      `PR           draft ${ticketRef(12)} https://example.test/pull/12`,
      'CI           running, 3 of 7 done',
      'Merge        stays yours',
      'Rollback     nothing merged, so nothing to undo',
    ]);
  });

  it('shows only untagged earlier commits neutrally and keeps amber for other tickets', () => {
    const untagged = { ...SHIPPING, inherited: { count: 4, tickets: [], merges: 0, untagged: 4 } };
    const quiet = shipsLines(parse({ ...FULL_ORD_501, ship: untagged }));
    const riding = quiet.find((line) => line[0]?.text.startsWith('Riding along'))!;
    expect(riding[1]).toEqual({ text: '4 commits, untagged, made before this change started' });
    const single = { ...SHIPPING, inherited: { count: 1, tickets: [], merges: 0, untagged: 1 } };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: single })))).toContain(
      'Riding along 1 commit, untagged, made before this change started',
    );
    const other = shipsLines(parse({ ...FULL_ORD_501, ship: SHIPPING }));
    const flagged = other.find((line) => line[0]?.text.startsWith('Riding along'))!;
    expect(flagged[1]).toMatchObject({ tone: 'warn' });
  });

  it('reads CI unknown, never green, when it was never saved, and names an unknown reason', () => {
    const never = { ...SHIPPING, ci: null };
    const ships = shipsLines(parse({ ...FULL_ORD_501, ship: never }));
    const ci = ships.find((line) => line[0]?.text.startsWith('CI'))!;
    expect(ci[1]).toEqual({ text: 'unknown, never recorded', tone: 'warn' });
    const unknown = { ...SHIPPING, ci: { state: 'unknown', reason: 'gh is signed out' } };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: unknown })))).toContain(
      'CI           unknown: gh is signed out',
    );
    const passed = { ...SHIPPING, ci: { state: 'pass', done: 7, total: 7 } };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: passed })))).toContain(
      'CI           passed',
    );
    const failed = { ...SHIPPING, ci: { state: 'fail' } };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: failed })))).toContain(
      'CI           failed',
    );
  });

  it('gives the revert for a merged change and reads an unknown split in words', () => {
    const merged = {
      ...SHIPPING,
      merge_commit: 'f00d',
      own: null,
      inherited: null,
      push: { state: 'failed' },
      pr: null,
    };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: merged })))).toEqual([
      'Own          76 commits, split unknown',
      'Riding along unknown',
      'Push         failed',
      'PR           not yet',
      'CI           running, 3 of 7 done',
      'Merge        merged f00d',
      'Rollback     git revert -m 1 f00d',
    ]);
    const alone = { ...SHIPPING, inherited: { count: 0, tickets: [], merges: 0, untagged: 0 } };
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: alone })))[1]).toBe('Riding along none');
  });

  it('names its empty state when nothing shipped', () => {
    expect(text(shipsLines(parse({ ...FULL_ORD_501, ship: null })))).toEqual([NOTHING_PUSHED]);
    expect(text(shipsLines(parse(FAST_ORD_490)))).toEqual([NOTHING_PUSHED]);
    expect(text(shipsLines(null))).toEqual([NOTHING_PUSHED]);
  });

  it('keeps a failing CI off the band as done', () => {
    const steps = shipSteps(
      parse({ ...FULL_ORD_501, ship: { ...SHIPPING, ci: { state: 'fail' } } }),
    );
    expect(steps.find((step) => step.label === 'CI')).toEqual({
      label: 'CI',
      word: 'fail',
      done: false,
    });
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

describe('which tab the pane opens on', () => {
  const verdictLanded = parse({ ...FULL_ORD_501 });
  const delivering = parse({
    ...FULL_ORD_501,
    stages: stages({ development: 'complete', delivery: 'running' }),
  });

  it('follows the auto rule when nobody picked a tab', () => {
    expect(autoTab(verdictLanded)).toBe('trust');
    expect(autoTab(delivering)).toBe('ships');
    expect(autoTab(parse({ ...FULL_ORD_501, verdict: null, ship: SHIPPING }))).toBe('ships');
    expect(autoTab(parse(ord501At('writing')))).toBe('table');
    expect(autoTab(parse(FAST_ORD_490))).toBe('cost');
    expect(autoTab(null)).toBe('cost');
    expect(deliveryInProgress(parse(PAUSED))).toBe(false);
  });

  it('never overrides a tab the person picked', () => {
    for (const snap of [verdictLanded, delivering, parse(FAST_ORD_490)]) {
      expect(shownTab(snap, 'record')).toBe('record');
    }
    const view = buildPaneView(verdictLanded, 'record');
    expect(view.tabs.find((tab) => tab.selected)?.id).toBe('record');
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.lines).toEqual([]);
  });

  it('collapses the tab labels below 80 columns and keeps them whole at 80', () => {
    const wide = buildPaneView(verdictLanded, null, { columns: SHORT_TAB_COLUMNS });
    expect(wide.tabs.map((tab) => tab.label)).toEqual([
      'High Table',
      'Cost',
      'Trust',
      'Ships',
      'Record',
    ]);
    const narrow = buildPaneView(verdictLanded, null, { columns: SHORT_TAB_COLUMNS - 1 });
    expect(narrow.tabs.map((tab) => tab.label)).toEqual(['Table', 'Cost', 'Trust', 'Ships', 'Rec']);
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
    expect(run('trust', FAST_ORD_490)).toBe(NO_GATES);
    expect(run('ships', snapshot({ active: true, ship: null }))).toBe(NOTHING_PUSHED);
    expect(run('record', { ...FULL_ORD_501, evidence_expected: PRESENT(['plan.json']) })).toContain(
      'Plan         recorded in plan.json',
    );
  });
});

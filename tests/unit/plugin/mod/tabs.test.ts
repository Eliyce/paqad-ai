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
  NO_PLAN,
  NOTHING_PUSHED,
  linesText,
  recordLines,
  trustLines,
} from '../../../../runtime/claude-plugin/mod/tabs.ts';
import { NOTHING_TO_PROVE, OLD_RECORD_NOTE } from '../../../../runtime/claude-plugin/mod/trust.ts';
import {
  FAST_ORD_490,
  FAST_ORD_490_PROOF,
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
  it('AC-34 and AC-36: groups the proof by the fast-lane stages in order, steps then gates', () => {
    expect(text(trustLines(parse(FAST_ORD_490)))).toEqual([
      'Plan  Recorded',
      '  ✓ Plan compiled  2 steps',
      '  ✓ Reuse checked  3 sources consulted',
      'Build  Running',
      '  ✓ Rules loaded  4 rules apply',
      '  ✓ Edits made  1 file changed',
      '  ○ Plan steps built  1 of 2',
      '    Nothing left half done  Not judged yet',
      '    Public surface stays stable  Not judged yet',
      '    No near-copies added  Not judged yet',
      'Checks  Not yet',
      '  ○ Checks run',
      '    Every criterion has a test  Not judged yet',
      '    Tests, types and lint pass  Not judged yet',
      '    Tests catch real mutations  Not judged yet',
      '    Quality did not drop  Not judged yet',
    ]);
  });

  it('AC-35: shows only the full-lane stages and their gates, with no ring, light or verdict', () => {
    const lines = text(trustLines(parse(FULL_ORD_501)));
    expect(lines.filter((entry) => !entry.startsWith(' ') && entry.includes('  '))).toEqual([
      'Plan  Recorded',
      'Spec  Recorded',
      'Build  Recorded',
      'Review  Recorded',
      'Checks  Recorded',
      'Docs  Recorded',
    ]);
    expect(lines).toContain('    The spec was reviewed  Pass');
    expect(lines).toContain('    Tests catch real mutations  Not required');
    expect(lines.join('\n')).not.toMatch(/required\b.*\d+\/\d+|Verdict|Safe to merge|Gates /);
    for (const code of ['stage-evidence', 'requirement-completeness', 'architecture-compliance']) {
      expect(lines.join('\n')).not.toContain(code);
    }
  });

  it('AC-35: never repeats the band headline', () => {
    for (const raw of [FAST_ORD_490, FULL_ORD_501]) {
      const snap = parse(raw);
      const lines = text(trustLines(snap));
      expect(lines.some((entry) => entry.includes(snap.headline.text))).toBe(false);
    }
  });

  it('AC-33: says paqad record gaps once in neutral words, and repairs as one dim line', () => {
    const snap = parse({
      ...FULL_ORD_501,
      flags: [],
      record_gaps: ['paqad could not record every stage of this change'],
      repairs: [
        { what: 'inferred the Build stage from the edits', at: null },
        { what: 'inferred the Build stage from the edits', at: null },
      ],
    });
    const lines = trustLines(snap);
    const gap = lines.filter((entry) => linesText([entry]).startsWith('paqad could not record'));
    expect(gap).toHaveLength(1);
    expect(gap[0]!.every((segment) => !segment.tone && !segment.dim)).toBe(true);
    const repair = lines.filter((entry) => linesText([entry]).startsWith('paqad repaired'));
    expect(repair).toEqual([
      [
        {
          text: 'paqad repaired its own record: inferred the Build stage from the edits',
          dim: true,
        },
      ],
    ]);
  });

  it('AC-31: an old snapshot with no proof shows only the gates it recorded, in plain words', () => {
    const old = { ...FULL_ORD_501, gates: GATES };
    delete (old as Record<string, unknown>).proof;
    const lines = text(trustLines(parse(old)));
    expect(lines.slice(0, 4)).toEqual([
      OLD_RECORD_NOTE,
      '    Tests, types and lint pass  Pass',
      '    No near-copies added  Fail',
      '    Tests catch real mutations  Not required',
    ]);
    expect(lines.join('\n')).not.toMatch(/review-quality|late-gate|Recorded/);
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

  it('shows each proof state with its one fixed label, and none and not-reproduced read Inconclusive', () => {
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
        const claim = lines.filter((entry) => entry.includes('Fix proof')).join('\n');
        expect(claim, proof).not.toContain('passed  ');
      }
    }
  });

  it('AC-37: says there is nothing to prove yet with no change or no evidence', () => {
    expect(text(trustLines(null))).toEqual([NOTHING_TO_PROVE]);
    expect(text(trustLines(parse(PAUSED)))).toEqual([NOTHING_TO_PROVE]);
    const bare = FAST_ORD_490_PROOF.map((stage) => ({
      ...stage,
      state: 'missing',
      steps: (stage.steps as Array<Record<string, unknown>>).map((step) => ({
        ...step,
        state: 'not-yet',
      })),
    }));
    expect(text(trustLines(parse({ ...FAST_ORD_490, proof: bare })))).toEqual([NOTHING_TO_PROVE]);
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

describe('which tab the Ledger opens on', () => {
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
    expect(run('trust', FAST_ORD_490)).toBe(linesText(trustLines(parse(FAST_ORD_490))));
    expect(run('trust', FAST_ORD_490).split('\n')[0]).toBe('Plan  Recorded');
    expect(run('ships', snapshot({ active: true, ship: null }))).toBe(NOTHING_PUSHED);
    expect(run('record', { ...FULL_ORD_501, evidence_expected: PRESENT(['plan.json']) })).toContain(
      'Plan         recorded in plan.json',
    );
  });
});

describe('the Record timeline', () => {
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

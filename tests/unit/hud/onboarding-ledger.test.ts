import { readFileSync, rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { appendChoice, choicesPath } from '@/onboarding/journey/choices.js';
import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';
import { buildView } from '@/onboarding/journey/view.js';
import { drawDesktopLedger } from '../../../runtime/claude-plugin/mod/desktop-ledger.tsx';
import {
  CHOICES_REVIEW,
  COST_BY_TIME,
  NOT_COMMITTED,
  buildJourneyLedger,
  journeyPaneLines,
  journeyPaneView,
  parseChoices,
  type JourneyChoice,
} from '../../../runtime/claude-plugin/mod/journey-ledger.ts';
import {
  parseJourneyView,
  type JourneyView,
} from '../../../runtime/claude-plugin/mod/journey-model.ts';
import type { PaqadPaneTab } from '../../../runtime/claude-plugin/mod/types/index.d.ts';

import { at, baseRun, clockAt, tempRoot, unitRow } from '../onboarding/journey/fixtures/journey.js';

const MODULES = Array.from({ length: 23 }, (_, i) => (i === 7 ? 'billing' : `m${i + 1}`));

function run(stages: Partial<JourneyRun['stages']>, extra: Partial<JourneyRun> = {}): JourneyRun {
  return { ...baseRun({ stages: { ...emptyStages(), ...stages }, ...extra }), revision: 2 };
}

const FIRST = {
  detect: { status: 'done' as const, started_at: at(0), ended_at: at(1) },
  setup: { status: 'done' as const, started_at: at(1), ended_at: at(3) },
  project_docs: { status: 'done' as const, started_at: at(3), ended_at: at(44) },
};

function viewOf(journey: JourneyRun, minute: number, rows = [] as Parameters<typeof buildView>[1]) {
  return parseJourneyView(JSON.stringify(buildView(journey, rows, { now: clockAt(minute) })))!;
}

function runningView(): JourneyView {
  const rows = MODULES.slice(0, 7).map((slug, i) =>
    unitRow('module_docs', slug, at(44 + (i + 1) * 2)),
  );
  return viewOf(
    run({ ...FIRST, module_docs: { status: 'running', started_at: at(44), plan: MODULES } }),
    58,
    rows,
  );
}

const CHOICES: JourneyChoice[] = [
  {
    id: 'C-1',
    ts: at(2),
    stage: 'setup',
    kind: 'allow_list',
    choice: 'Wrote .claude/settings.local.json entries',
    by: 'tray',
  },
  {
    id: 'C-2',
    ts: at(50),
    stage: 'rules_discovery',
    kind: 'signoff',
    choice: 'Signed off 12 new rules (recommended)',
    by: 'paqad-onboarding',
  },
];

function ledger(view: JourneyView, tab: PaqadPaneTab | null, minute = 58) {
  return buildJourneyLedger({
    view,
    choices: CHOICES,
    tab,
    workflow: { name: 'onboarding', tokens: 412_000, usd: 6.1 } as never,
    now: Date.parse(at(minute)),
  });
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('AC-11: the onboarding Ledger tabs', () => {
  it('shows Stages · Choices · Results · Cost, Stages first', () => {
    const shown = ledger(runningView(), null);
    expect(shown.subtitle).toBe('What happened, with proof · Onboarding');
    expect(shown.tabs.map((tab) => tab.label)).toEqual(['Stages', 'Choices', 'Results', 'Cost']);
    expect(shown.shown).toBe('trust');
    expect(ledger(runningView(), 'table').shown).toBe('trust');
    expect(journeyPaneView(shown).tabs.map((tab) => tab.selected)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('Stages: a heading per step with its right word and step lines', () => {
    const lines = journeyPaneLines(ledger(runningView(), 'trust'));
    expect(lines).toContain('WRITE THE PROJECT DOCS  ✓ Done 41 min');
    expect(lines).toContain('WRITE THE MODULE DOCS  Running 14:00');
    expect(lines).toContain('  ✓ 7 of 23 · billing');
    expect(lines).toContain('RESEARCH RULES FOR YOUR STACK  Not yet');
    expect(lines).toMatchSnapshot();
  });

  it('Stages: a stopped step says where Resume picks up, and a gap names its kind', () => {
    const stopped = viewOf(
      run(
        { ...FIRST, module_docs: { status: 'failed', started_at: at(44), plan: MODULES } },
        { status: 'failed' },
      ),
      50,
      MODULES.slice(0, 7).map((slug, i) => unitRow('module_docs', slug, at(45 + i))),
    );
    const stage = ledger(stopped, 'trust', 50).stages[3]!;
    expect(stage.word).toBe('Stopped');
    expect(stage.tone).toBe('fail');
    const stages = emptyStages();
    for (const id of Object.keys(stages) as Array<keyof typeof stages>) {
      stages[id] = { status: 'done' };
    }
    stages.rules_discovery = { status: 'degraded', degraded: ['research_offline'] };
    const gap = viewOf(run(stages, { commit: { answer: 'no', answered_at: at(2) } }), 3);
    const research = ledger(gap, 'trust', 3).stages[4]!;
    expect(research.word).toBe('Done, offline');
    expect(research.tone).toBe('cau');
    expect(research.steps[0]?.words).toBe(gap.gaps[0]?.footnote);
  });

  it('AC-9: Choices lists newest first in local time with the review hint until reviewed', () => {
    const shown = ledger(runningView(), 'record');
    expect(shown.choices.rows.map((row) => row.key)).toEqual(['C-2', 'C-1']);
    expect(shown.choices.rows[0]?.text).toBe(
      `Research · Signoff · Signed off 12 new rules (recommended) · ${CHOICES_REVIEW}`,
    );
    expect(shown.choices.rows[1]?.text).toContain('Set up · Allow list · Wrote');
    expect(shown.choices.rows[0]?.time).toMatch(/^\d\d:\d\d$/u);
    const reviewed = buildJourneyLedger({
      view: runningView(),
      choices: [{ ...CHOICES[1]!, reviewed: true }],
      tab: 'record',
      workflow: null,
      now: Date.parse(at(58)),
    });
    expect(reviewed.choices.rows[0]?.text.endsWith('· reviewed')).toBe(true);
  });

  it('AC-9: reads the choices.jsonl the journey writes', () => {
    const root = tempRoot('paqad-ledger-choices-');
    roots.push(root);
    appendChoice(root, {
      ts: at(5),
      run_id: 'run-1',
      stage: 'rules_discovery',
      kind: 'signoff',
      choice: 'Signed off 3 rules',
      reason: 'recommended',
      by: 'paqad-onboarding',
    });
    const rows = parseChoices(readFileSync(choicesPath(root), 'utf8'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'C-1', kind: 'signoff', by: 'paqad-onboarding' });
    expect(parseChoices('not json\n{"id":"C-9"}\n')).toEqual([]);
  });

  it('AC-8 AC-20: Results counts the work, links the files and names what was left out', () => {
    const stages = emptyStages();
    for (const id of Object.keys(stages) as Array<keyof typeof stages>) {
      stages[id] = { status: 'done' };
    }
    stages.module_docs = { status: 'done', plan: MODULES };
    const done = viewOf(
      run(stages, {
        commit: {
          answer: 'branch',
          answered_at: at(2),
          branch: 'feature/paqad-onboarding',
          left_out: [{ path: 'docs/instructions/stack/overview.md', reason: 'edited' }],
        },
      }),
      3,
    );
    expect(done.left_out).toEqual([
      { path: 'docs/instructions/stack/overview.md', reason: 'edited' },
    ]);
    const lines = journeyPaneLines(ledger(done, 'ships', 3));
    expect(lines[0]).toBe('23 modules');
    expect(lines).toContain('1 choice made for you');
    expect(lines).toContain('Report: .paqad/onboarding/report.md');
    expect(lines).toContain('Module map: docs/instructions/rules/module-map.yml');
    expect(lines).toContain('Rule script map: docs/instructions/rules/rule-script-map.yml');
    expect(lines.slice(-2)).toEqual([NOT_COMMITTED, '  docs/instructions/stack/overview.md']);
  });

  it('Cost: the total plus one meter per step', () => {
    const cost = ledger(runningView(), 'cost').cost;
    expect(cost.total).toBe('412K tokens');
    expect(cost.money).toBe('~$6.10 estimate');
    expect(cost.note).toBe(COST_BY_TIME);
    expect(cost.stages.map((meter) => [meter.name, meter.right])).toEqual([
      ['Read', '1 min'],
      ['Set up', '2 min'],
      ['Docs', '41 min'],
      ['Modules', '14 min'],
    ]);
    expect(cost.stages[2]?.share).toBe(1);
  });
});

(globalThis as { React?: unknown }).React = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ({
    type,
    props: { ...(props ?? {}), children },
  }),
};

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return texts(props.children);
}

describe('AC-11: the desktop Ledger draws the onboarding tabs', () => {
  const ui = new Proxy({}, { get: (_target, name) => String(name) }) as never;
  const actions = {
    tab: () => undefined,
    answer: () => undefined,
    sides: () => undefined,
    seat: () => undefined,
  };

  it('draws the subtitle, the four tabs and each tab body', () => {
    for (const [tab, expected] of [
      ['trust', 'WRITE THE MODULE DOCS'],
      ['record', 'Signed off 12 new rules (recommended)'],
      ['ships', 'Rule script map'],
      ['cost', '412K tokens'],
    ] as const) {
      const drawn = texts(
        drawDesktopLedger(
          ui,
          { kind: 'onboarding', ledger: ledger(runningView(), tab) },
          { sides: false, seat: null },
          actions,
        ),
      ).join('|');
      expect(drawn, tab).toContain('What happened, with proof · Onboarding');
      expect(drawn, tab).toContain('Stages|Choices|Results|Cost');
      expect(drawn, tab).toContain(expected);
    }
  });
});

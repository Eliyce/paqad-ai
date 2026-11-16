import { formatStopwatch, formatTokens, formatUsd } from './cost';
import { localTime, type CostMeter, type LedgerTab, type RecordView } from './desktop-view';
import { ONBOARDING_WORD, type JourneyView, type JourneyViewStage } from './journey-model';
import { tabKey, type PaneView } from './pane';
import type { TrustStage, TrustStep } from './trust';
import type { PaqadPaneTab, PaqadWorkflow } from './types';

export const JOURNEY_CHOICES_PATH = '.paqad/onboarding/choices.jsonl';
export const JOURNEY_REPORT_PATH = '.paqad/onboarding/report.md';
export const MODULE_MAP_PATH = 'docs/instructions/rules/module-map.yml';
export const RULE_SCRIPT_MAP_PATH = 'docs/instructions/rules/rule-script-map.yml';
export const JOURNEY_SUBTITLE = `What happened, with proof · ${ONBOARDING_WORD}`;
export const CHOICES_REVIEW = 'review: paqad-ai onboarding choices';
export const NO_CHOICES = 'No choices made for you yet.';
export const NOT_COMMITTED = 'Not committed: you were editing these';
export const COST_BY_TIME =
  'Tokens are counted for the whole journey; the bars show how long each step took.';
export const COST_COUNTING = 'counting';

export const JOURNEY_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string }> = [
  { id: 'trust', label: 'Stages' },
  { id: 'record', label: 'Choices' },
  { id: 'ships', label: 'Results' },
  { id: 'cost', label: 'Cost' },
];

export const GAP_WORDS: Readonly<Record<string, string>> = {
  stack_mismatch_noted: 'Done, stack noted',
  git_workflow_kept: 'Done, kept your git workflow',
  research_offline: 'Done, offline',
  research_stopped: 'Done, research stopped early',
  rag_off: 'Done, search index off',
};

export interface JourneyChoice {
  id: string;
  ts: string;
  stage: string;
  kind: string;
  choice: string;
  reason?: string;
  by?: string;
  reviewed?: boolean;
}

export interface JourneyResults {
  lines: string[];
  files: Array<{ label: string; path: string }>;
  notCommitted: string[];
}

export interface JourneyCost {
  total: string;
  money: string | null;
  note: string;
  stages: CostMeter[];
}

export interface JourneyLedger {
  subtitle: string;
  tabs: LedgerTab[];
  shown: PaqadPaneTab;
  stages: TrustStage[];
  choices: RecordView;
  results: JourneyResults;
  cost: JourneyCost;
}

export function parseChoices(text: string | null): JourneyChoice[] {
  if (!text) return [];
  const rows: JourneyChoice[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as Partial<JourneyChoice>;
      if (typeof row.id === 'string' && typeof row.ts === 'string') rows.push(row as JourneyChoice);
    } catch {
      continue;
    }
  }
  return rows;
}

export function journeyTabs(shown: PaqadPaneTab | null): LedgerTab[] {
  const picked = JOURNEY_TABS.some((tab) => tab.id === shown) ? shown : 'trust';
  const width = `${Math.floor(100 / JOURNEY_TABS.length)}%`;
  return JOURNEY_TABS.map((tab) => ({ ...tab, width, shown: tab.id === picked }));
}

function minutesBetween(from: string | null | undefined, to: number): number | null {
  const start = from ? Date.parse(from) : Number.NaN;
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.round((to - start) / 60_000));
}

function stageMinutes(stage: JourneyViewStage, now: number): number | null {
  const end = stage.ended_at ? Date.parse(stage.ended_at) : now;
  return minutesBetween(stage.started_at, Number.isFinite(end) ? end : now);
}

const COUNTED: Readonly<Record<string, { unit: string; key: 'modules' | 'packages' | 'rules' }>> = {
  module_docs: { unit: 'modules', key: 'modules' },
  rules_discovery: { unit: 'packages', key: 'packages' },
  rules_analyze: { unit: 'rules', key: 'rules' },
};

function doneSteps(view: JourneyView, stage: JourneyViewStage): TrustStep[] {
  const counted = COUNTED[stage.id];
  const count = counted ? view.planned?.[counted.key] : null;
  if (!counted || count === null || count === undefined) return [];
  return [
    {
      key: `${stage.id}-count`,
      mark: 'done',
      words: `${count} of ${count} ${counted.unit}`,
      detail: stage.id === 'module_docs' ? 'docs/modules/' : null,
    },
  ];
}

function failedStage(
  view: JourneyView,
  stage: JourneyViewStage,
  base: Pick<TrustStage, 'key' | 'words' | 'gates' | 'run'>,
): TrustStage {
  const sub = stage.sub_progress;
  const next = sub?.current ?? null;
  const progress: TrustStep[] = sub?.words
    ? [{ key: `${stage.id}-progress`, mark: 'failed', words: sub.words, detail: null }]
    : [];
  return {
    ...base,
    word: view.status === 'paused' ? 'Interrupted' : 'Stopped',
    tone: 'fail',
    mark: null,
    steps: [
      ...progress,
      {
        key: `${stage.id}-resume`,
        mark: 'not-yet',
        words: next ? `Resume picks up at ${next}` : 'Resume picks up at the first unfinished unit',
        detail: null,
      },
    ],
  };
}

export function journeyStage(view: JourneyView, stage: JourneyViewStage, now: number): TrustStage {
  const minutes = stageMinutes(stage, now);
  const base = { key: `onboarding-${stage.id}`, words: stage.name, gates: [], run: null };
  if (stage.state === 'done') {
    return {
      ...base,
      word: minutes === null ? 'Done' : `Done ${minutes} min`,
      tone: 'pass',
      mark: '✓',
      steps: doneSteps(view, stage),
    };
  }
  if (stage.state === 'degraded') {
    return {
      ...base,
      word: GAP_WORDS[stage.gaps[0] ?? ''] ?? 'Done with a gap',
      tone: 'cau',
      mark: null,
      steps: view.gaps
        .filter((gap) => gap.stage === stage.id)
        .map((gap) => ({
          key: `${stage.id}-${gap.code}`,
          mark: 'not-yet' as const,
          words: gap.footnote,
          detail: gap.next_action,
        })),
    };
  }
  if (stage.state === 'running') {
    const started = stage.started_at ? Date.parse(stage.started_at) : Number.NaN;
    const words = stage.sub_progress?.words;
    return {
      ...base,
      word: Number.isFinite(started) ? `Running ${formatStopwatch(now - started)}` : 'Running',
      tone: 'acc',
      mark: null,
      steps: words ? [{ key: `${stage.id}-progress`, mark: 'done', words, detail: null }] : [],
    };
  }
  if (stage.state === 'failed') return failedStage(view, stage, base);
  return { ...base, word: 'Not yet', tone: 'dim', mark: null, steps: [] };
}

function wordsOf(text: string): string {
  const spaced = text.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function choicesView(view: JourneyView, rows: readonly JourneyChoice[]): RecordView {
  if (rows.length === 0) return { rows: [], empty: NO_CHOICES };
  const label = (stage: string) =>
    view.stages.find((entry) => entry.id === stage)?.label ?? wordsOf(stage);
  const sorted = [...rows].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return {
    rows: sorted.map((row) => ({
      key: row.id,
      time: localTime(row.ts),
      text: [
        label(row.stage),
        wordsOf(row.kind),
        row.choice,
        row.reviewed ? 'reviewed' : CHOICES_REVIEW,
      ].join(' · '),
    })),
    empty: null,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function resultsView(view: JourneyView, choices: readonly JourneyChoice[]): JourneyResults {
  const planned = view.planned;
  const counts = [
    typeof planned?.modules === 'number' ? plural(planned.modules, 'module') : null,
    typeof planned?.packages === 'number' ? plural(planned.packages, 'package') : null,
    typeof planned?.rules === 'number' ? plural(planned.rules, 'rule') : null,
  ].filter((entry): entry is string => entry !== null);
  const auto = choices.filter((row) => row.by === 'paqad-onboarding').length;
  return {
    lines: [
      ...(counts.length > 0 ? [counts.join(' · ')] : []),
      `${plural(auto, 'choice')} made for you`,
      ...view.gaps.map((gap) => gap.footnote),
      ...(view.uncommitted_note ? [view.uncommitted_note] : []),
    ],
    files: [
      { label: 'Report', path: JOURNEY_REPORT_PATH },
      { label: 'Module map', path: MODULE_MAP_PATH },
      { label: 'Rule script map', path: RULE_SCRIPT_MAP_PATH },
    ],
    notCommitted: (view.left_out ?? []).map((entry) => entry.path),
  };
}

export function journeyCostView(
  view: JourneyView,
  workflow: PaqadWorkflow | null,
  now: number,
): JourneyCost {
  const spent = view.stages.flatMap((stage) => {
    const minutes = stageMinutes(stage, now);
    return minutes === null ? [] : [{ stage, minutes }];
  });
  const longest = Math.max(1, ...spent.map((entry) => entry.minutes));
  return {
    total:
      workflow && workflow.tokens !== null
        ? `${formatTokens(workflow.tokens)} tokens`
        : COST_COUNTING,
    money: workflow && workflow.usd !== null ? `~${formatUsd(workflow.usd)} estimate` : null,
    note: COST_BY_TIME,
    stages: spent.map(({ stage, minutes }) => ({
      key: stage.id,
      name: stage.label,
      right: `${minutes} min`,
      share: minutes / longest,
    })),
  };
}

export function buildJourneyLedger(input: {
  view: JourneyView;
  choices: readonly JourneyChoice[];
  tab: PaqadPaneTab | null;
  workflow: PaqadWorkflow | null;
  now: number;
}): JourneyLedger {
  const tabs = journeyTabs(input.tab);
  return {
    subtitle: JOURNEY_SUBTITLE,
    tabs,
    shown: tabs.find((tab) => tab.shown)?.id ?? 'trust',
    stages: input.view.stages.map((stage) => journeyStage(input.view, stage, input.now)),
    choices: choicesView(input.view, input.choices),
    results: resultsView(input.view, input.choices),
    cost: journeyCostView(input.view, input.workflow, input.now),
  };
}

const STEP_MARK: Readonly<Record<TrustStep['mark'], string>> = {
  done: '✓',
  failed: '✕',
  'not-yet': '○',
};

function stageLines(stage: TrustStage): string[] {
  return [
    `${stage.words.toUpperCase()}  ${stage.mark ? `${stage.mark} ` : ''}${stage.word}`,
    ...stage.steps.map(
      (step) => `  ${STEP_MARK[step.mark]} ${step.words}${step.detail ? ` · ${step.detail}` : ''}`,
    ),
  ];
}

export function journeyPaneLines(ledger: JourneyLedger): string[] {
  switch (ledger.shown) {
    case 'record':
      return ledger.choices.empty
        ? [ledger.choices.empty]
        : ledger.choices.rows.map((row) => `${row.time}  ${row.text}`);
    case 'ships':
      return [
        ...ledger.results.lines,
        ...ledger.results.files.map((file) => `${file.label}: ${file.path}`),
        ...(ledger.results.notCommitted.length > 0
          ? [NOT_COMMITTED, ...ledger.results.notCommitted.map((path) => `  ${path}`)]
          : []),
      ];
    case 'cost':
      return [
        [ledger.cost.total, ledger.cost.money].filter(Boolean).join(' · '),
        ledger.cost.note,
        ...ledger.cost.stages.map((meter) => `${meter.name} · ${meter.right}`),
      ];
    default:
      return ledger.stages.flatMap(stageLines);
  }
}

export function journeyPaneView(ledger: JourneyLedger): PaneView {
  return {
    subtitle: ledger.subtitle,
    tabs: ledger.tabs.map((tab) => ({
      id: tab.id,
      key: tabKey(tab.id),
      label: tab.label,
      selected: tab.shown,
    })),
    lines: journeyPaneLines(ledger),
    rows: [],
    table: null,
  };
}

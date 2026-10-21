import { allGreenNow, changeChip } from './band';
import {
  CHANGE_SCOPE_SENTENCE,
  WHOLE_SESSION_SENTENCE,
  formatClock,
  formatStopwatch,
  formatTokens,
  formatUsd,
  roleWords,
} from './cost';
import { needsAnswers, roleInitials, tableStatus } from './instruments';
import { stageSegments, type SegmentState } from './model';
import type { Signal } from './palette';
import { shipRail, type ShipStepState } from './ship';
import { FEATURE_ROUTE, statusEntryRoute, workflowCost, workflowWords } from './status-entry';
import type {
  ChiefState,
  GateMark,
  Mark,
  SeatState,
  ShipState,
  StageState,
  StripInput,
  TableSeat,
} from './strip';
import { hasRuled, showsTable, trackRecordWords } from './table';
import { needsYou, visibilityMode, type BandVisibility } from './visibility';
import type {
  PaqadCiJob,
  PaqadCost,
  PaqadCostLine,
  PaqadHighTable,
  PaqadHudSnapshot,
  PaqadPaneTab,
  PaqadSeat,
  PaqadTimelineEntry,
} from './types';

export const READY_WORDS = 'Ready';
export const UNREADABLE = "paqad cannot read this session's record";
export const UNREADABLE_WHY = {
  'session-id': 'The session id could not be read.',
  snapshot: 'The snapshot file is not valid.',
} as const;
export const GETTING_READY = 'Getting ready';
export const FEATURE_WORDS = 'Feature development';
export const CLOSED_WORDS = 'Closed for this session';
export const HIDDEN_WORDS = 'Hidden';
export const NEEDS_YOU_WORDS = 'Needs you';
export const CLOSE_MENU_QUESTION = 'Close the paqad band?';

export const CARD_ROWS = { identity: 1, message: 1, strip: 3, menu: 1 } as const;

export type Unreadable = keyof typeof UNREADABLE_WHY;

const CONFLICT_CATEGORY = 'spec.expert_conflict';

export const FAILURE_PHRASES: Readonly<Record<string, string>> = {
  'code-tests-lint': 'Tests, types or lint failed',
  'spec-review': 'The spec review found a blocking defect',
  'implementation-review': 'The code review found a blocking issue',
  'quality-ratchet': 'Quality dropped below the baseline',
  duplication: 'A near-copy of existing code was added',
  'documentation-freshness': 'The docs no longer match the code',
  'ac-test-mapping': 'A criterion has no test',
  'change-completeness': 'Something is left half done',
  'mutation-testing': 'The tests missed real mutations',
  'module-docs-structure': 'A module doc lost its shape',
  'instructions-docs-structure': 'An instruction doc lost its shape',
  'extension-surface': 'The public surface changed',
  'architecture-compliance': 'An architecture rule is broken',
  'database-quality': 'A database change is unsafe',
  'fix-proof': 'The fix has no proving test',
  'behavioral-correctness': 'The behaviour does not match the spec',
  'requirement-completeness': 'A requirement is incomplete',
  'story-quality': 'A story is not well formed',
  'site-map-freshness': 'The site map no longer matches the app',
  'bundle-completeness': 'The evidence bundle is incomplete',
};

export function failurePhrase(code: string): string {
  return FAILURE_PHRASES[code] ?? `${code} failed`;
}

export const LANE_WORDS: Readonly<Record<string, string>> = {
  fast: 'Fast lane',
  graduated: 'Graduated lane',
  full: 'Full lane',
};

const FULL_STAGES: ReadonlyArray<readonly [string, string]> = [
  ['ticket_intake', 'Intake'],
  ['planning', 'Plan'],
  ['specification', 'Spec'],
  ['development', 'Build'],
  ['review', 'Review'],
  ['checks', 'Checks'],
  ['documentation_sync', 'Docs'],
  ['delivery', 'Deliver'],
];

const FAST_STAGES = new Set(['planning', 'development', 'checks']);

export function laneStages(lane: string | null): ReadonlyArray<readonly [string, string]> {
  return lane === 'fast' ? FULL_STAGES.filter(([stage]) => FAST_STAGES.has(stage)) : FULL_STAGES;
}

export function stageWord(stage: string): string {
  return FULL_STAGES.find(([id]) => id === stage)?.[1] ?? stage;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalised(words: string): string {
  return words.length > 0 ? `${words[0]!.toUpperCase()}${words.slice(1)}` : words;
}

function prName(snapshot: PaqadHudSnapshot): string {
  const number = snapshot.ship?.pr_number ?? null;
  return number === null ? 'The PR' : `PR #${number}`;
}

function clockSince(startedAt: string | null | undefined, now: number): string | null {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(started) ? formatStopwatch(now - started) : null;
}

function ruleStopped(snapshot: PaqadHudSnapshot): boolean {
  return snapshot.last_block !== null && snapshot.last_block.used !== true;
}

function gateOrder(snapshot: PaqadHudSnapshot): (name: string) => number {
  return (name) => {
    const index = snapshot.gates_expected.indexOf(name);
    return index === -1 ? snapshot.gates_expected.length : index;
  };
}

function failingGates(snapshot: PaqadHudSnapshot): string[] {
  const rank = gateOrder(snapshot);
  return snapshot.gates
    .filter((gate) => gate.required && gate.verdict === 'fail')
    .map((gate) => gate.name)
    .sort((a, b) => rank(a) - rank(b));
}

export function failureHeadline(snapshot: PaqadHudSnapshot): string {
  const [first, ...rest] = failingGates(snapshot);
  if (!first) return snapshot.verdict?.word ?? 'Needs your attention';
  return rest.length > 0 ? `${failurePhrase(first)} and ${rest.length} more` : failurePhrase(first);
}

function runningWords(snapshot: PaqadHudSnapshot, stage: string): string {
  switch (stage) {
    case 'ticket_intake':
      return 'Reading the ticket';
    case 'planning':
      return 'Planning the change';
    case 'specification': {
      const table = snapshot.table;
      if (table?.seats.some((seat) => seat.state === 'writing')) {
        return 'The High Table is writing its notes';
      }
      if (table?.chief?.state === 'writing') return 'The chief architect is ruling';
      return 'Writing the spec';
    }
    case 'development':
      return snapshot.plan
        ? `${snapshot.plan.done} of ${snapshot.plan.steps} plan steps built`
        : 'Building';
    case 'review':
      return 'Reviewing the change';
    case 'checks':
      return 'Running the checks';
    case 'documentation_sync':
      return 'Syncing the docs';
    case 'delivery':
      return 'Delivering';
    default:
      return `${stageWord(stage)} is running`;
  }
}

export interface DesktopHeadline {
  row: number;
  signal: Signal;
  live: boolean;
  text: string;
  clock: string | null;
}

function headline(
  row: number,
  signal: Signal,
  text: string,
  clock: string | null = null,
): DesktopHeadline {
  return { row, signal, live: signal === 'accent', text, clock };
}

function settledHeadline(snapshot: PaqadHudSnapshot): DesktopHeadline {
  const segments = stageSegments(snapshot);
  const lane = new Set(laneStages(snapshot.lane).map(([stage]) => stage));
  const drawn = segments.filter((segment) => lane.has(segment.stage));
  const done = [...drawn].reverse().find((segment) => segment.state === 'done');
  const next = drawn.find(
    (segment) =>
      segment.state === 'not yet' &&
      snapshot.stages.find((stage) => stage.stage === segment.stage)?.mandatory === true,
  );
  if (done && next) {
    return headline(18, 'idle', `${stageWord(done.stage)} done. Next: ${stageWord(next.stage)}`);
  }
  if (!done) return headline(19, 'idle', 'Next: Plan');
  return headline(20, 'idle', 'Every stage is recorded. Waiting for the verdict.');
}

export function desktopHeadline(snapshot: PaqadHudSnapshot, now: number): DesktopHeadline {
  if (!snapshot.active) return headline(3, 'idle', GETTING_READY);
  const pending = snapshot.decisions.pending;
  const table = snapshot.table;
  const conflicts = pending.filter((decision) => decision.category === CONFLICT_CATEGORY).length;
  if (pending.length > 0 && table && hasRuled(table) && conflicts > 0) {
    return headline(
      4,
      'attention',
      `The chief architect has ${plural(conflicts, 'question', 'questions')} for you`,
    );
  }
  if (pending.length > 0) {
    return headline(
      5,
      'attention',
      pending.length === 1
        ? '1 decision is waiting for you'
        : `${pending.length} decisions are waiting for you`,
    );
  }
  if (ruleStopped(snapshot)) {
    const block = snapshot.last_block!;
    const what = block.title ?? block.rule;
    return headline(
      6,
      'attention',
      what ? `A rule stopped an edit: ${what}` : 'A rule stopped an edit',
    );
  }
  const rail = shipRail(snapshot);
  const step = (label: string) => rail.steps.find((entry) => entry.label === label)?.state;
  if (snapshot.ship?.merged) return headline(7, 'pass', `${prName(snapshot)} is merged`);
  if (allGreenNow(snapshot)) {
    return headline(8, 'pass', `${prName(snapshot)} is ready for your merge`);
  }
  if (snapshot.ship?.pr_state === 'closed') {
    return headline(9, 'attention', `${prName(snapshot)} was closed`);
  }
  if (step('CI') === 'failed') return headline(10, 'fail', `CI failed on ${prName(snapshot)}`);
  if (snapshot.ship?.push === 'failed') return headline(11, 'fail', 'The push failed');
  const verdict = snapshot.verdict;
  if (verdict?.kind === 'fail') return headline(12, 'fail', failureHeadline(snapshot));
  if (verdict?.kind === 'inconclusive') {
    const reason = verdict.reasons[0];
    return headline(13, 'attention', reason ? `Inconclusive: ${reason}` : 'Inconclusive');
  }
  if (step('CI') === 'current') {
    const delivery = snapshot.stages.find((stage) => stage.stage === 'delivery');
    return headline(
      14,
      'accent',
      `Watching CI on ${prName(snapshot)}`,
      clockSince(delivery?.started_at, now),
    );
  }
  const running = snapshot.stages.find((stage) => stage.state === 'running');
  if (running) {
    return headline(
      15,
      'accent',
      runningWords(snapshot, running.stage),
      clockSince(running.started_at, now),
    );
  }
  if (verdict?.kind === 'pass') {
    return snapshot.ship?.commit_decision === 'decline'
      ? headline(16, 'pass', 'Done: the edit is in your working tree')
      : headline(17, 'pass', 'Safe to merge');
  }
  return settledHeadline(snapshot);
}

export function costWords(cost: PaqadHudSnapshot['cost']): string | null {
  if (!cost) return null;
  const tokens = `${formatTokens(cost.tokens.total)} tokens${cost.live ? ' so far' : ''}`;
  if (cost.scope === 'whole-session') return `${tokens} · whole session`;
  return cost.usd === null ? tokens : `${tokens} · ~${formatUsd(cost.usd)}`;
}

export interface IdentityView {
  parts: string[];
  flags: number;
}

export function identityView(snapshot: PaqadHudSnapshot): IdentityView {
  const active = snapshot.active;
  const lane = active && snapshot.lane ? (LANE_WORDS[snapshot.lane] ?? null) : null;
  const parts = [
    FEATURE_WORDS,
    lane,
    changeChip(snapshot),
    active ? costWords(snapshot.cost) : null,
  ];
  return {
    parts: parts.filter((part): part is string => part !== null),
    flags: active ? snapshot.flags.length : 0,
  };
}

export function identityText(identity: IdentityView): string {
  return `   ${identity.parts.join('  ·  ')}`;
}

export function flagWords(flags: number): string {
  return plural(flags, 'flag', 'flags');
}

function paused(snapshot: PaqadHudSnapshot): boolean {
  return snapshot.decisions.pending.length > 0 || ruleStopped(snapshot);
}

const STAGE_STATE: Readonly<Record<SegmentState, StageState>> = {
  done: 'done',
  running: 'run',
  marked: 'marked',
  failed: 'fail',
  'not required': 'skip',
  'not yet': 'todo',
};

function markedValue(snapshot: PaqadHudSnapshot, stage: string): string {
  const record = snapshot.stages.find((entry) => entry.stage === stage);
  const word = stageWord(stage);
  if (record?.duration_unreliable) return `${word} marked: no recorded work`;
  if (record?.state === 'inconclusive') return `${word} inconclusive`;
  if (stage === 'checks') return 'Checks: no test run recorded';
  return `${word} marked`;
}

export interface StageStrip {
  stages: Array<Mark<StageState>>;
  value: string;
  word: string | null;
}

export function stageStrip(snapshot: PaqadHudSnapshot): StageStrip {
  const segments = stageSegments(snapshot);
  const hold = paused(snapshot);
  const stages = laneStages(snapshot.lane).map(([stage, label]) => {
    const state = segments.find((segment) => segment.stage === stage)?.state ?? 'not yet';
    const mark: StageState = state === 'running' && hold ? 'paused' : STAGE_STATE[state];
    return { stage, label, state: mark };
  });
  const running = stages.find((entry) => entry.state === 'run' || entry.state === 'paused');
  const failed = stages.find((entry) => entry.state === 'fail');
  const marked = stages.find((entry) => entry.state === 'marked');
  const drawn = stages.filter((entry) => entry.state !== 'skip');
  let value = '';
  if (running) value = running.state === 'paused' ? `${running.label} · paused` : running.label;
  else if (failed) value = `${failed.label} failed`;
  else if (marked) value = markedValue(snapshot, marked.stage);
  else if (snapshot.active && drawn.length > 0 && drawn.every((entry) => entry.state === 'done')) {
    value = snapshot.ship?.merged ? 'Delivered' : 'All stages done';
  }
  return {
    stages: stages.map(({ label, state }) => ({ label, state })),
    value,
    word: running ? running.label : null,
  };
}

export interface TableStrip {
  seats: Array<Mark<SeatState>> | null;
  chief: ChiefState;
  value: string;
}

const TABLE_VALUES: Readonly<Record<string, string>> = {
  'chief is ruling': 'Chief is ruling',
  'needs answers': 'Needs answers',
  'spec approved': 'Spec approved',
  'chief ruled': 'Chief ruled',
};

export function chiefState(snapshot: PaqadHudSnapshot): ChiefState {
  const table = snapshot.table;
  if (!table?.chief) return 'waiting';
  if (table.chief.state === 'writing') return 'ruling';
  if (hasRuled(table)) return needsAnswers(snapshot, table) ? 'needs' : 'done';
  return 'waiting';
}

export function tableStrip(snapshot: PaqadHudSnapshot): TableStrip {
  if (!showsTable(snapshot) || snapshot.table.skipped) {
    return { seats: null, chief: 'waiting', value: '' };
  }
  const table = snapshot.table;
  const status = tableStatus(snapshot, table);
  const value = / standing$/.test(status) ? 'Seated' : (TABLE_VALUES[status] ?? status);
  return {
    seats: table.seats.map((seat) => ({
      label: roleInitials(seat.role),
      state: seat.late ? 'late' : seat.state,
    })),
    chief: chiefState(snapshot),
    value,
  };
}

export type DeliveryLabel = 'Edit' | 'Commit' | 'Push' | 'PR' | 'CI' | 'Merge';

const SHIP_STATE: Readonly<Record<ShipStepState, ShipState>> = {
  done: 'done',
  current: 'run',
  todo: 'todo',
  failed: 'fail',
  closed: 'fail',
  ready: 'ready',
  unknown: 'todo',
};

export function deliverySteps(snapshot: PaqadHudSnapshot): DeliveryLabel[] {
  const plan = snapshot.delivery_plan;
  if (!plan) return ['Edit', 'Commit', 'Push', 'PR', 'CI', 'Merge'];
  const steps: DeliveryLabel[] = ['Edit'];
  if (plan.commit) steps.push('Commit');
  if (plan.push) steps.push('Push');
  if (plan.pr) steps.push('PR');
  if (plan.ci) steps.push('CI');
  if (plan.merge) steps.push('Merge');
  return steps;
}

export interface DeliveryStrip {
  steps: Array<Mark<ShipState>>;
  ci: number | null;
  value: string;
}

function deliveryValue(snapshot: PaqadHudSnapshot): string {
  if (!snapshot.active) return '';
  const rail = shipRail(snapshot);
  const plan = snapshot.delivery_plan;
  const ship = snapshot.ship;
  const state = (label: string) => rail.steps.find((step) => step.label === label)?.state;
  const prOpen = ship?.pr_state === 'open';
  if (rail.merged) return `${prName(snapshot)} merged`;
  if (rail.allGreen) return 'Merge is yours';
  if (state('PR') === 'closed') return 'PR closed';
  if (state('Merge') === 'unknown') return 'PR state unknown';
  if (state('CI') === 'failed') return 'CI failed';
  if (rail.ci && plan?.ci !== false) return `${rail.ci.done} of ${rail.ci.total} checks green`;
  if (prOpen && plan && !plan.ci) return 'No CI · merge is yours';
  if (prOpen) return prName(snapshot);
  if (state('Push') === 'failed') return 'Push failed';
  if (state('Push') === 'done') return 'Pushed';
  if (plan && !plan.commit) return 'Edit only · no commit';
  if (plan && !plan.push) return 'No push for this change';
  const commits = ship?.commits ?? 0;
  if (commits > 0) return `${plural(commits, 'commit', 'commits')} of yours`;
  if (state('Edit') === 'current') return 'Editing';
  return '';
}

export function deliveryStrip(snapshot: PaqadHudSnapshot): DeliveryStrip {
  const rail = shipRail(snapshot);
  const steps = deliverySteps(snapshot).map((label) => ({
    label,
    state: SHIP_STATE[rail.steps.find((step) => step.label === label)?.state ?? 'todo'],
  }));
  const ciRunning = steps.some((step) => step.label === 'CI' && step.state === 'run');
  return {
    steps,
    ci: ciRunning && rail.ci ? rail.ci.done / rail.ci.total : null,
    value: deliveryValue(snapshot),
  };
}

export function stripOf(snapshot: PaqadHudSnapshot, columns: number): StripInput {
  const stage = stageStrip(snapshot);
  const table = tableStrip(snapshot);
  const delivery = deliveryStrip(snapshot);
  return {
    columns,
    stages: stage.stages,
    stageValue: stage.value,
    seats: table.seats,
    chief: table.chief,
    tableValue: table.value,
    delivery: delivery.steps,
    ci: delivery.ci,
    deliveryValue: delivery.value,
  };
}

export function stripAltText(text: string, strip: StripInput): string {
  const parts = [`${text.replace(/\.$/, '')}.`, `Stage ${strip.stageValue || 'not started'}.`];
  if (strip.seats && strip.tableValue) parts.push(`High Table ${strip.tableValue}.`);
  if (strip.deliveryValue) parts.push(`Delivery ${strip.deliveryValue}.`);
  return parts.join(' ');
}

export function cardRows(menuOpen: boolean): number {
  return CARD_ROWS.identity + CARD_ROWS.message + CARD_ROWS.strip + (menuOpen ? CARD_ROWS.menu : 0);
}

export interface MinimisedView {
  light: Signal;
  live: boolean;
  text: string;
  stages: StageState[];
  cost: string | null;
}

function minimisedView(
  snapshot: PaqadHudSnapshot,
  head: DesktopHeadline,
  stage: StageStrip,
): MinimisedView {
  const word = head.live ? stage.word : null;
  const text = word ? (head.clock ? `${word} · ${head.clock}` : word) : stage.value || head.text;
  return {
    light: head.signal,
    live: head.live,
    text,
    stages: stage.stages.map((mark) => mark.state),
    cost: snapshot.active ? costWords(snapshot.cost) : null,
  };
}

export type DesktopBand =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'unreadable'; reason: Unreadable; headline: string }
  | {
      kind: 'workflow';
      words: string;
      running: boolean;
      clock: string | null;
      cost: string;
    }
  | { kind: 'closed' | 'hidden'; needsYou: boolean }
  | {
      kind: 'feature';
      mode: 'card' | 'minimised';
      menu: boolean;
      identity: IdentityView;
      headline: DesktopHeadline;
      strip: StripInput;
      alt: string;
      minimised: MinimisedView;
    };

export interface DesktopBandInput {
  snapshot: PaqadHudSnapshot | null;
  unbound: boolean;
  unavailable: boolean;
  now: number;
  turnStartedAt: number | null;
  visibility: BandVisibility;
  menuOpen: boolean;
  columns: number;
  maxRows: number;
}

export function unreadableReason(input: {
  snapshot: PaqadHudSnapshot | null;
  unbound: boolean;
  unavailable: boolean;
}): Unreadable | null {
  if (input.unbound) return 'session-id';
  if (input.unavailable && input.snapshot === null) return 'snapshot';
  return null;
}

function workflowBand(
  snapshot: PaqadHudSnapshot,
  route: string,
  now: number,
  turnStartedAt: number | null,
): DesktopBand {
  const workflow = snapshot.workflow?.name === route ? snapshot.workflow : null;
  return {
    kind: 'workflow',
    words: capitalised(workflowWords(route)),
    running: turnStartedAt !== null,
    clock: turnStartedAt === null ? null : formatStopwatch(now - turnStartedAt),
    cost: workflowCost(workflow) ?? 'counting',
  };
}

export function buildDesktopBand(input: DesktopBandInput): DesktopBand {
  const unreadable = unreadableReason(input);
  if (unreadable) return { kind: 'unreadable', reason: unreadable, headline: UNREADABLE };
  const snapshot = input.snapshot;
  if (!snapshot) return { kind: 'ready' };
  const route = statusEntryRoute(snapshot);
  if (route) return workflowBand(snapshot, route, input.now, input.turnStartedAt);
  if (!snapshot.active && snapshot.route !== FEATURE_ROUTE) return { kind: 'none' };
  const mode = visibilityMode(input.visibility);
  if (mode === 'closed' || mode === 'hidden') return { kind: mode, needsYou: needsYou(snapshot) };
  const head = desktopHeadline(snapshot, input.now);
  const strip = stripOf(snapshot, input.columns);
  const fits = input.maxRows >= cardRows(input.menuOpen);
  return {
    kind: 'feature',
    mode: mode === 'minimised' || !fits ? 'minimised' : 'card',
    menu: input.menuOpen,
    identity: identityView(snapshot),
    headline: head,
    strip,
    alt: stripAltText(head.text, strip),
    minimised: minimisedView(snapshot, head, stageStrip(snapshot)),
  };
}

export function bandIsLive(band: DesktopBand): boolean {
  if (band.kind === 'workflow') return band.running;
  return band.kind === 'feature' && band.headline.live;
}

export type WordTone = 'pass' | 'fail' | 'acc' | 'att' | 'dim';

export interface LightView {
  signal: Signal;
  title: string;
  why: string | null;
}

export interface LedgerTab {
  id: PaqadPaneTab;
  label: string;
  width: string;
  shown: boolean;
}

export const LEDGER_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string }> = [
  { id: 'trust', label: 'Trust' },
  { id: 'table', label: 'High Table' },
  { id: 'ships', label: 'Delivery' },
  { id: 'record', label: 'Record' },
  { id: 'cost', label: 'Cost' },
];

export function tableSat(
  snapshot: PaqadHudSnapshot | null,
): snapshot is PaqadHudSnapshot & { table: PaqadHighTable } {
  return showsTable(snapshot) && !snapshot.table.skipped;
}

export function ledgerTabs(snapshot: PaqadHudSnapshot | null, shown: PaqadPaneTab): LedgerTab[] {
  const tabs = LEDGER_TABS.filter((tab) => tab.id !== 'table' || tableSat(snapshot));
  const picked = tabs.some((tab) => tab.id === shown) ? shown : 'trust';
  const width = `${Math.floor(100 / tabs.length)}%`;
  return tabs.map((tab) => ({ ...tab, width, shown: tab.id === picked }));
}

export function ledgerSubtitle(snapshot: PaqadHudSnapshot | null): string {
  const chip = changeChip(snapshot);
  return chip ? `What happened, with proof  ·  ${chip}` : 'What happened, with proof';
}

const NOT_JUDGED_LIGHT: LightView = {
  signal: 'idle',
  title: 'Not judged yet',
  why: 'Gates are judged after Build, Review and Checks. Nothing reads as a pass before that.',
};

export const GATE_WORDS: Readonly<Record<string, string>> = {
  'spec-review': 'The spec was reviewed',
  'requirement-completeness': 'Every requirement is complete',
  'story-quality': 'The stories are well formed',
  'implementation-review': 'The code was reviewed',
  'code-tests-lint': 'Tests, types and lint pass',
  'behavioral-correctness': 'The behaviour matches the spec',
  'quality-ratchet': 'Quality did not drop',
  duplication: 'No near-copies added',
  'documentation-freshness': 'Docs match the code',
  'ac-test-mapping': 'Every criterion has a test',
  'change-completeness': 'Nothing left half done',
  'mutation-testing': 'Tests catch real mutations',
  'module-docs-structure': 'Module docs keep their shape',
  'instructions-docs-structure': 'Instruction docs keep their shape',
  'extension-surface': 'Public surface stays stable',
  'architecture-compliance': 'The architecture rules hold',
  'database-quality': 'Database changes are safe',
  'fix-proof': 'The fix is proven by a test',
  'site-map-freshness': 'The site map matches the app',
  'bundle-completeness': 'The evidence bundle is complete',
};

export interface TrustGate {
  name: string;
  words: string;
  how: string;
  required: boolean;
  verdict: string;
  word: string;
  tone: WordTone;
  arc: GateMark;
}

const HOW_JUDGED: Readonly<Record<string, string>> = {
  deterministic: 'Checked by a script',
  'llm-judged': 'Judged by a reviewer agent',
};

const VERDICT_WORDS_DESKTOP: Readonly<Record<string, { word: string; tone: WordTone }>> = {
  pass: { word: 'Pass', tone: 'pass' },
  fail: { word: 'Fail', tone: 'fail' },
  inconclusive: { word: 'Inconclusive', tone: 'att' },
  'did-not-run': { word: 'Did not run', tone: 'att' },
  'not-required': { word: 'Not required', tone: 'dim' },
};

const ARC_TONE: Readonly<Record<string, GateMark['verdict']>> = {
  pass: 'pass',
  fail: 'fail',
  inconclusive: 'attention',
  'did-not-run': 'attention',
};

export function trustGates(snapshot: PaqadHudSnapshot): TrustGate[] {
  const rows = new Map(snapshot.gates.map((gate) => [gate.name, gate]));
  const names = [
    ...snapshot.gates_expected,
    ...snapshot.gates
      .map((gate) => gate.name)
      .filter((name) => !snapshot.gates_expected.includes(name)),
  ];
  const judged = snapshot.verdict !== null;
  const gates = [...new Set(names)].map((name, order) => {
    const row = rows.get(name);
    const verdict = row ? row.verdict : judged ? 'not-required' : 'not-judged';
    const required = row ? row.required && row.verdict !== 'not-required' : !judged;
    const look = VERDICT_WORDS_DESKTOP[verdict] ?? { word: 'Not judged yet', tone: 'dim' as const };
    return {
      order,
      gate: {
        name,
        words: GATE_WORDS[name] ?? name,
        how: (row?.strength && HOW_JUDGED[row.strength]) || 'How it is judged is not recorded',
        required,
        verdict,
        word: look.word,
        tone: look.tone,
        arc: { required, verdict: ARC_TONE[verdict] ?? 'wait' },
      },
    };
  });
  return gates
    .sort((a, b) => Number(b.gate.required) - Number(a.gate.required) || a.order - b.order)
    .map(({ gate }) => gate);
}

export interface GateRingView {
  marks: GateMark[];
  passed: number;
  required: number;
  alt: string;
}

export function gateRingView(gates: readonly TrustGate[]): GateRingView {
  const required = gates.filter((gate) => gate.required).length;
  const passed = gates.filter((gate) => gate.required && gate.verdict === 'pass').length;
  return {
    marks: gates.map((gate) => gate.arc),
    passed,
    required,
    alt: `${passed} of ${required} required gates pass`,
  };
}

export function trustLight(
  snapshot: PaqadHudSnapshot | null,
  unreadable: Unreadable | null,
  now: number,
): LightView {
  if (unreadable)
    return { signal: 'attention', title: UNREADABLE, why: UNREADABLE_WHY[unreadable] };
  if (!snapshot || !snapshot.active) {
    return {
      signal: 'idle',
      title: GETTING_READY,
      why: 'The change opens when planning starts. Nothing is judged before that.',
    };
  }
  const head = desktopHeadline(snapshot, now);
  const pending = snapshot.decisions.pending.length;
  const pr = prName(snapshot);
  switch (head.row) {
    case 4: {
      const questions = snapshot.decisions.pending.filter(
        (decision) => decision.category === CONFLICT_CATEGORY,
      ).length;
      return {
        signal: 'attention',
        title: 'Waiting for your answers',
        why: `The chief ruled "needs answers". The spec freezes once you answer the ${plural(questions, 'question', 'questions')}.`,
      };
    }
    case 5:
      return {
        signal: 'attention',
        title: 'Waiting for your answers',
        why: `${pending === 1 ? '1 decision needs' : `${pending} decisions need`} your answer before work goes on.`,
      };
    case 6: {
      const block = snapshot.last_block!;
      return {
        signal: 'attention',
        title: 'A rule stopped an edit',
        why: block.title ?? block.rule ?? block.text,
      };
    }
    case 7:
      return { signal: 'pass', title: 'Merged', why: `${pr} is merged.` };
    case 8:
    case 17:
      return { signal: 'pass', title: 'Safe to merge', why: safeToMergeWhy(snapshot) };
    case 9:
      return { signal: 'attention', title: 'PR closed', why: `${pr} was closed without a merge.` };
    case 10:
      return {
        signal: 'fail',
        title: 'CI failed',
        why: `CI failed on ${pr}. Fix it and push again.`,
      };
    case 11:
      return { signal: 'fail', title: 'The push failed', why: null };
    case 12:
      return {
        signal: 'fail',
        title: 'Needs your attention',
        why: `${failureHeadline(snapshot)}. Fix it and run the checks again.`,
      };
    case 13:
      return {
        signal: 'attention',
        title: 'Inconclusive',
        why: snapshot.verdict?.reasons.join('; ') || null,
      };
    case 16:
      return {
        signal: 'pass',
        title: 'Checks passed',
        why: 'Nothing to merge: the edit is in your working tree, uncommitted, as you asked.',
      };
    default:
      return NOT_JUDGED_LIGHT;
  }
}

function safeToMergeWhy(snapshot: PaqadHudSnapshot): string {
  const gates = trustGates(snapshot);
  const required = gates.filter((gate) => gate.required).length;
  const passed = gates.filter((gate) => gate.required && gate.verdict === 'pass').length;
  const skipped = gates.length - required;
  const head = `${passed} of ${required} required gates pass.`;
  return skipped > 0
    ? `${head} ${plural(skipped, 'gate was', 'gates were')} not required for this change and ${skipped === 1 ? 'is' : 'are'} not counted.`
    : head;
}

export interface ClaimRow {
  key: string;
  id: string | null;
  label: string;
  sub: string;
  word: string;
  tone: WordTone;
}

export interface ClaimsView {
  rows: ClaimRow[];
  more: string | null;
  empty: string | null;
}

export const CLAIMS_LATER =
  'Claims appear when the spec is frozen. Each one is listed with the test that proves it.';
export const CLAIMS_LIMIT = 4;

function specFrozen(snapshot: PaqadHudSnapshot): boolean {
  const spec = snapshot.stages.find((stage) => stage.stage === 'specification');
  return spec?.state === 'complete' || spec?.state === 'redone';
}

export function claimsView(snapshot: PaqadHudSnapshot): ClaimsView {
  const rows: ClaimRow[] = snapshot.claims.map((claim, index) => {
    const proven = claim.verdict === 'pass';
    const fix = claim.kind === 'fix-proof';
    return {
      key: claim.id ?? `${claim.kind}-${index}`,
      id: claim.id,
      label: claim.label,
      sub: claim.test_id ?? 'No proving test recorded',
      word: proven ? 'Proven' : 'Not proven',
      tone: proven ? 'pass' : fix ? 'att' : 'dim',
    };
  });
  if (rows.length === 0) {
    return {
      rows,
      more: null,
      empty: specFrozen(snapshot) ? 'No claim recorded for this change.' : CLAIMS_LATER,
    };
  }
  const rest = rows.slice(CLAIMS_LIMIT);
  const more =
    rest.length === 0
      ? null
      : rest.every((row) => row.word === 'Proven')
        ? `+${rest.length} more, all proven`
        : `+${rest.length} more`;
  return { rows: rows.slice(0, CLAIMS_LIMIT), more, empty: null };
}

export interface FlagRow {
  id: string;
  text: string;
}

export interface TrustView {
  light: LightView;
  ring: GateRingView;
  gates: TrustGate[];
  claims: ClaimsView;
  flags: FlagRow[];
}

export function trustView(snapshot: PaqadHudSnapshot, now: number): TrustView {
  const gates = trustGates(snapshot);
  return {
    light: trustLight(snapshot, null, now),
    ring: gateRingView(gates),
    gates,
    claims: claimsView(snapshot),
    flags: snapshot.active ? snapshot.flags.map((flag) => ({ id: flag.id, text: flag.text })) : [],
  };
}

export interface SeatRow {
  role: string;
  initials: string;
  words: string;
  picked: boolean;
  word: string;
  tone: WordTone;
  details: string[];
}

export interface ChiefView {
  state: ChiefState;
  light: LightView;
  conflicts: Array<{ target: string; recommendation: string; rationale: string }>;
  answer: string | null;
}

export interface TableView {
  ring: TableSeat[];
  chief: ChiefState;
  alt: string;
  summary: { notes: string; findings: string; picked: string; standing: string };
  chiefView: ChiefView;
  seats: SeatRow[];
  shaped: {
    rows: Array<{ id: string; line: string; who: string }>;
    total: string | null;
    empty: string | null;
  };
}

export const ANSWER_TOAST =
  'Type your answers in the chat. The questions are in the High Table tab.';
export const SHAPED_LATER =
  'Shown when the spec is frozen: each spec line with the experts who shaped it.';

function spanClock(from: string | null, to: string | null): string | null {
  const ms = Date.parse(to ?? '') - Date.parse(from ?? '');
  return Number.isFinite(ms) && ms >= 0 ? formatClock(ms) : null;
}

function seatTokens(seat: PaqadSeat): number | null {
  return seat.tokens?.total ?? seat.tokens_estimate ?? null;
}

function seatDetails(seat: PaqadSeat): string[] {
  const details: string[] = [];
  if (seat.reason) details.push(seat.reason);
  if (seat.tokens_estimate !== null && seat.budget_tokens !== null) {
    details.push(
      `Note: ~${formatTokens(seat.tokens_estimate)} tokens of its ${formatTokens(seat.budget_tokens)} budget`,
    );
  }
  if (seat.tokens) {
    details.push(
      `Run: ${formatTokens(seat.tokens.total)} tokens (${seat.tokens_exact ? 'exact, from Claude Code' : 'estimate'})`,
    );
  }
  if (seat.track_record) details.push(trackRecordWords(seat.track_record));
  return details;
}

function seatRow(seat: PaqadSeat): SeatRow {
  const took = spanClock(seat.started_at, seat.done_at);
  const findings = seat.findings === null ? null : plural(seat.findings, 'finding', 'findings');
  const done = [took, findings].filter((part): part is string => part !== null).join(' · ');
  return {
    role: seat.role,
    initials: roleInitials(seat.role),
    words: roleWords(seat.role),
    picked: seat.origin !== 'standing',
    word:
      seat.state === 'writing' ? 'writing…' : seat.state === 'seated' ? 'seated' : done || 'done',
    tone: seat.state === 'writing' ? 'acc' : 'dim',
    details: seatDetails(seat),
  };
}

function chiefLight(table: PaqadHighTable, state: ChiefState): LightView {
  const chief = table.chief;
  const tokens =
    chief && seatTokens(chief) !== null ? `${formatTokens(seatTokens(chief)!)} tokens` : null;
  const ruledIn = chief ? spanClock(chief.started_at, chief.done_at) : null;
  const join = (...parts: Array<string | null>) =>
    parts.filter((part): part is string => part !== null).join(' · ') || null;
  if (state === 'needs') {
    return {
      signal: 'attention',
      title: 'Needs your answers',
      why: join(ruledIn ? `Ruled in ${ruledIn}` : null, tokens),
    };
  }
  if (state === 'done') {
    const answers = table.rulings?.settled.length ?? 0;
    return {
      signal: 'idle',
      title: 'Approved',
      why: join(
        answers > 0
          ? `After your ${plural(answers, 'answer', 'answers')}`
          : ruledIn
            ? `Ruled in ${ruledIn}`
            : null,
        tokens,
      ),
    };
  }
  if (state === 'ruling') {
    return { signal: 'accent', title: 'Ruling', why: 'The chief architect is reading the notes.' };
  }
  return {
    signal: 'idle',
    title: 'Listening',
    why: `Rules when all ${plural(table.seats.length, 'note has', 'notes have')} landed`,
  };
}

function specLines(specText: string | null): { lines: Map<string, string>; total: number } {
  const lines = new Map<string, string>();
  let total = 0;
  for (const raw of (specText ?? '').split(/\r?\n/)) {
    const match = /^\s*-\s+((?:FR|AC)-\d+):\s*(.*)$/.exec(raw);
    if (!match) continue;
    total += 1;
    if (!lines.has(match[1]!)) lines.set(match[1]!, match[2]!);
  }
  return { lines, total };
}

export function tableView(snapshot: PaqadHudSnapshot, specText: string | null): TableView | null {
  if (!tableSat(snapshot)) return null;
  const table = snapshot.table;
  const state = chiefState(snapshot);
  const seats = table.seats;
  const done = seats.filter((seat) => seat.state === 'done' || seat.late).length;
  const findings = seats.reduce((sum, seat) => sum + (seat.findings ?? 0), 0);
  const standing = seats.filter((seat) => seat.origin === 'standing').length;
  const open = snapshot.decisions.pending.filter(
    (decision) => decision.category === CONFLICT_CATEGORY,
  ).length;
  const { lines, total } = specLines(specText);
  return {
    ring: seats.map((seat) => ({
      label: roleInitials(seat.role),
      state: seat.late ? 'late' : seat.state,
      findings: seat.findings,
    })),
    chief: state,
    alt: `${done} of ${seats.length} notes landed`,
    summary: {
      notes: `${done} of ${plural(seats.length, 'note', 'notes')}`,
      findings: plural(findings, 'finding', 'findings'),
      picked: `${seats.length - standing} picked for this change`,
      standing: `${standing} always at the table`,
    },
    chiefView: {
      state,
      light: chiefLight(table, state),
      conflicts: state === 'needs' ? (table.rulings?.conflicts ?? []) : [],
      answer:
        state === 'needs'
          ? `Walk me through the ${plural(Math.max(open, 1), 'open decision', 'open decisions')}`
          : null,
    },
    seats: seats.map(seatRow),
    shaped: {
      rows: table.credits.map((credit) => ({
        id: credit.line,
        line: lines.get(credit.line) ?? credit.line,
        who: credit.roles.map(roleInitials).join(' · '),
      })),
      total:
        table.credits.length > 0 && total > 0
          ? `${table.credits.length} of ${total} spec lines came from an expert note.`
          : null,
      empty: table.credits.length === 0 ? SHAPED_LATER : null,
    },
  };
}

export interface DeliveryJob {
  name: string;
  time: string;
  tone: WordTone;
  share: number | null;
}

export interface DeliveryBlock {
  label: DeliveryLabel;
  state: ShipState;
  title: string;
  sub: string | null;
  right: string | null;
  reached: boolean;
  commits: Array<{ sha: string; subject: string; own: boolean }>;
  jobs: DeliveryJob[];
  link: { href: string; text: string } | null;
  ci: number | null;
}

const JOB_PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const JOB_FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']);
const JOB_QUEUED = new Set(['QUEUED', 'PENDING', 'EXPECTED', 'WAITING', 'REQUESTED']);

function deliveryJob(job: PaqadCiJob): DeliveryJob {
  const outcome = (job.conclusion ?? job.status ?? '').toUpperCase();
  const took = spanClock(job.started_at, job.completed_at);
  if (JOB_FAILED.has(outcome))
    return { name: job.name, time: took ?? 'failed', tone: 'fail', share: 1 };
  if (JOB_PASSED.has(outcome))
    return { name: job.name, time: took ?? 'done', tone: 'dim', share: 1 };
  if (JOB_QUEUED.has(outcome)) return { name: job.name, time: 'queued', tone: 'dim', share: 0 };
  return { name: job.name, time: 'running', tone: 'dim', share: null };
}

function ciSub(ship: NonNullable<PaqadHudSnapshot['ship']>): string {
  const ci = ship.ci_detail;
  if (!ci || ci.total === null || ci.total === 0) return 'Runs on the pull request';
  if (ci.state === 'pass') {
    const started = ci.jobs.map((job) => Date.parse(job.started_at ?? '')).filter(Number.isFinite);
    const ended = ci.jobs.map((job) => Date.parse(job.completed_at ?? '')).filter(Number.isFinite);
    const took =
      started.length > 0 && ended.length > 0
        ? formatClock(Math.max(...ended) - Math.min(...started))
        : null;
    return `All ${ci.total} checks passed${took ? ` in ${took}` : ''}`;
  }
  return `${ci.done ?? 0} of ${ci.total} checks green`;
}

function blockText(
  snapshot: PaqadHudSnapshot,
  label: DeliveryLabel,
  state: ShipState,
): {
  title: string;
  sub: string | null;
  right: string | null;
} {
  const ship = snapshot.ship;
  const pr = prName(snapshot);
  switch (label) {
    case 'Edit': {
      const files = ship?.files_changed ?? null;
      return {
        title: 'Edit',
        sub:
          state === 'todo'
            ? 'Code changes start after the spec is frozen.'
            : files === null
              ? null
              : `${plural(files, 'file', 'files')} changed by this change`,
        right: null,
      };
    }
    case 'Commit': {
      const own = ship?.commits ?? 0;
      return {
        title: 'Commits',
        sub: own > 0 ? `${own} by this change` : 'None of yours yet',
        right: null,
      };
    }
    case 'Push':
      return {
        title: 'Push',
        sub:
          ship?.push === 'failed'
            ? 'The push failed'
            : ship?.push === 'pushed'
              ? `${ship.push_branch ?? 'The branch'} on origin`
              : 'After Checks and Docs',
        right: null,
      };
    case 'PR': {
      const opened = ship !== null && ship.pr_number !== null;
      const size =
        ship && ship.pr_additions !== null && ship.pr_deletions !== null
          ? `+${ship.pr_additions} −${ship.pr_deletions}`
          : null;
      return {
        title: 'Pull request',
        sub: opened
          ? `#${ship.pr_number}${ship.pr_title ? ` ${ship.pr_title}` : ''}`
          : 'Opened after the push',
        right: opened ? size : null,
      };
    }
    case 'CI':
      return { title: 'CI', sub: ship ? ciSub(ship) : 'Runs on the pull request', right: null };
    case 'Merge':
      return {
        title: 'Merge',
        sub: ship?.merged
          ? `${pr} is merged.`
          : state === 'ready'
            ? 'Everything is green. The merge is yours.'
            : 'The merge is always yours. paqad never merges.',
        right: null,
      };
  }
}

export interface DeliveryView {
  blocks: DeliveryBlock[];
  empty: string | null;
}

export function deliveryView(snapshot: PaqadHudSnapshot): DeliveryView {
  if (!snapshot.active) return { blocks: [], empty: 'Nothing to deliver yet.' };
  const strip = deliveryStrip(snapshot);
  const ship = snapshot.ship;
  return {
    empty: null,
    blocks: strip.steps.map(({ label, state }) => {
      const text = blockText(snapshot, label as DeliveryLabel, state);
      const reached = state !== 'todo';
      return {
        label: label as DeliveryLabel,
        state,
        ...text,
        reached,
        commits:
          label === 'Commit' && ship
            ? ship.commit_list.map((commit) => ({
                sha: commit.sha.slice(0, 7),
                subject: commit.subject,
                own: commit.own !== false,
              }))
            : [],
        jobs:
          label === 'CI' && reached && ship?.ci_detail ? ship.ci_detail.jobs.map(deliveryJob) : [],
        link:
          label === 'Merge' && state === 'ready' && ship?.pr_url
            ? { href: ship.pr_url, text: `Open ${prName(snapshot)}` }
            : null,
        ci: label === 'CI' ? strip.ci : null,
      };
    }),
  };
}

export function localTime(at: string): string {
  const date = new Date(Date.parse(at));
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function recordWords(snapshot: PaqadHudSnapshot, entry: PaqadTimelineEntry): string | null {
  const stage = entry.stage ? stageWord(entry.stage) : 'A stage';
  const count = entry.count ?? 0;
  switch (entry.kind) {
    case 'open': {
      if (entry.note) return `Reopened: ${entry.note}`;
      const issue = entry.issue
        ? /^\d+$/.test(entry.issue)
          ? `#${entry.issue}`
          : entry.issue
        : null;
      const name = [issue, entry.title].filter(Boolean).join(' ');
      const lane = entry.lane ? `${entry.lane} lane` : null;
      const what = [name || null, lane].filter(Boolean).join(', ');
      return what ? `Change opened: ${what}` : 'Change opened';
    }
    case 'close':
      return entry.note ? `Closed: ${entry.note}` : 'Closed';
    case 'stage_start':
      return entry.own_agent ? `${stage} started in its own agent` : `${stage} started`;
    case 'stage_end':
      return entry.duration_ms !== undefined
        ? `${stage} done in ${formatClock(entry.duration_ms)}`
        : `${stage} done`;
    case 'rules_loaded':
      return `Rules loaded: ${count} apply`;
    case 'table_seated':
      return `High Table seated: ${entry.picked ?? 0} picked, ${entry.standing ?? 0} standing`;
    case 'notes_landed':
      return `All ${plural(count, 'note', 'notes')} landed, ${plural(entry.findings ?? 0, 'finding', 'findings')}`;
    case 'chief_ruled': {
      const took = entry.duration_ms !== undefined ? ` in ${formatClock(entry.duration_ms)}` : '';
      return `Chief ruled${took}${entry.verdict ? `: ${entry.verdict}` : ''}`;
    }
    case 'decisions_opened':
      return `${plural(count, 'decision', 'decisions')} opened for you`;
    case 'decisions_answered':
      return `You answered ${plural(count, 'decision', 'decisions')}`;
    case 'spec_frozen':
      return `Spec frozen: ${plural(entry.requirements ?? 0, 'requirement', 'requirements')}, ${plural(entry.criteria ?? 0, 'criterion', 'criteria')}`;
    case 'commit':
      return `Commit ${(entry.sha ?? '').slice(0, 5)}: ${entry.subject ?? ''}`.trim();
    case 'push':
      return entry.state === 'failed'
        ? 'The push failed'
        : `Pushed ${plural(count, 'commit', 'commits')}`;
    case 'pr_opened':
      return entry.number !== undefined
        ? `PR #${entry.number} opened`
        : `${prName(snapshot)} opened`;
    case 'ci':
      return entry.state === 'fail'
        ? 'CI failed'
        : `CI green on all ${plural(count, 'job', 'jobs')}`;
    default:
      return null;
  }
}

export interface RecordView {
  rows: Array<{ key: string; time: string; text: string }>;
  empty: string | null;
}

export const RECORD_LATER = 'The record starts when the change opens.';

export function recordView(snapshot: PaqadHudSnapshot): RecordView {
  const rows = snapshot.active
    ? snapshot.timeline.flatMap((entry, index) => {
        const text = recordWords(snapshot, entry);
        return text ? [{ key: `${entry.at}-${index}`, time: localTime(entry.at), text }] : [];
      })
    : [];
  return { rows, empty: rows.length === 0 ? RECORD_LATER : null };
}

export interface CostMeter {
  key: string;
  name: string;
  right: string;
  share: number;
}

export interface CostView {
  total: string;
  money: string;
  note: string;
  live: string | null;
  stages: CostMeter[];
  table: CostMeter[];
  notCounted: string;
}

export const NOT_COUNTED_WORDS =
  'Not counted: your own typing time, other sessions, and the HUD itself (0 tokens).';
export const COUNTING_WORDS = 'Counting: this turn is still running.';

function lineRight(line: PaqadCostLine): string {
  const tokens = formatTokens(line.tokens.total);
  return line.usd === null ? tokens : `${tokens} · ${formatUsd(line.usd)}`;
}

function meters(entries: Array<{ key: string; name: string; line: PaqadCostLine }>): CostMeter[] {
  const largest = Math.max(0, ...entries.map((entry) => entry.line.tokens.total));
  return entries.map((entry) => ({
    key: entry.key,
    name: entry.name,
    right: lineRight(entry.line),
    share: largest > 0 ? entry.line.tokens.total / largest : 0,
  }));
}

function costStageName(stage: string, table: boolean): string {
  if (stage === 'orchestrator') return 'Between stages';
  if (stage === 'specification' && table) return 'Spec, with the High Table';
  return stageWord(stage);
}

export function costMoney(cost: PaqadCost): string {
  return cost.usd === null
    ? cost.unpriced_models.length > 0
      ? `No price for ${cost.unpriced_models.join(', ')}`
      : 'No money figure'
    : `~${formatUsd(cost.usd)} estimate at API prices · ${cost.price_table_date} prices`;
}

export function costView(snapshot: PaqadHudSnapshot): CostView | null {
  const cost = snapshot.active ? snapshot.cost : null;
  if (!cost) return null;
  const sat = tableSat(snapshot);
  const scope = cost.scope === 'whole-session' ? WHOLE_SESSION_SENTENCE : CHANGE_SCOPE_SENTENCE;
  return {
    total: `${formatTokens(cost.tokens.total)} tokens`,
    money: costMoney(cost),
    note: [cost.plan_note, scope].filter((part) => part.length > 0).join(' '),
    live: cost.live ? COUNTING_WORDS : null,
    stages: meters(
      cost.by_stage.map((line) => ({
        key: line.stage,
        name: costStageName(line.stage, sat),
        line,
      })),
    ),
    table: sat
      ? meters([
          ...(cost.chief ? [{ key: 'chief', name: 'Chief architect', line: cost.chief }] : []),
          ...cost.by_expert.map((line) => ({ key: line.role, name: roleWords(line.role), line })),
        ])
      : [],
    notCounted: NOT_COUNTED_WORDS,
  };
}

export interface WorkflowLedger {
  light: LightView;
  total: string;
  money: string | null;
  note: string;
}

export function workflowLedger(snapshot: PaqadHudSnapshot, route: string): WorkflowLedger {
  const words = workflowWords(route);
  const workflow = snapshot.workflow?.name === route ? snapshot.workflow : null;
  return {
    light: {
      signal: 'accent',
      title: capitalised(words),
      why: 'No change in this session, so there is nothing to prove. paqad shows what this workflow cost.',
    },
    total:
      workflow?.tokens === null || !workflow
        ? 'counting'
        : `${formatTokens(workflow.tokens)} tokens`,
    money:
      workflow && workflow.usd !== null
        ? `~${formatUsd(workflow.usd)} estimate at API prices`
        : null,
    note: `Counted from when this ${words} started in this session. Nothing from other sessions or earlier changes.`,
  };
}

export type DesktopLedger =
  | { kind: 'none' }
  | { kind: 'unreadable'; light: LightView }
  | { kind: 'workflow'; view: WorkflowLedger }
  | {
      kind: 'feature';
      subtitle: string;
      tabs: LedgerTab[];
      shown: PaqadPaneTab;
      trust: TrustView;
      table: TableView | null;
      delivery: DeliveryView;
      record: RecordView;
      cost: CostView | null;
    };

export interface DesktopLedgerInput {
  snapshot: PaqadHudSnapshot | null;
  unbound: boolean;
  unavailable: boolean;
  tab: PaqadPaneTab | null;
  now: number;
  specText: string | null;
}

export function buildDesktopLedger(input: DesktopLedgerInput): DesktopLedger {
  const unreadable = unreadableReason(input);
  if (unreadable) return { kind: 'unreadable', light: trustLight(null, unreadable, input.now) };
  const snapshot = input.snapshot;
  if (!snapshot) return { kind: 'none' };
  const route = statusEntryRoute(snapshot);
  if (route) return { kind: 'workflow', view: workflowLedger(snapshot, route) };
  const tabs = ledgerTabs(snapshot, input.tab ?? 'trust');
  return {
    kind: 'feature',
    subtitle: ledgerSubtitle(snapshot),
    tabs,
    shown: tabs.find((tab) => tab.shown)!.id,
    trust: trustView(snapshot, input.now),
    table: tableView(snapshot, input.specText),
    delivery: deliveryView(snapshot),
    record: recordView(snapshot),
    cost: costView(snapshot),
  };
}

export function ledgerIsLive(ledger: DesktopLedger): boolean {
  if (ledger.kind !== 'feature') return false;
  const writing = ledger.table?.seats.some((seat) => seat.word === 'writing…') ?? false;
  const ruling = ledger.table?.chief === 'ruling' || ledger.table?.chief === 'needs';
  const running = ledger.delivery.blocks.some((block) => block.state === 'run');
  return writing || ruling || running;
}

export const UPDATE_PLAN_TOOL = 'mcp__ccd_turn__update_plan';

export const TASK_LIST_SENTENCES = {
  full: 'paqad task list: Plan, Spec, Load rules, Build, Review, Checks, Docs. Start each item with that word, in this order. Items before Plan (read the ticket) and after Docs (open the PR) are fine.',
  fast: 'paqad task list: Plan, Build, Checks. Start each item with that word, in this order. Items before Plan and after Checks are fine.',
} as const;

const TASK_WORDS = {
  full: ['plan', 'spec', 'load rules', 'build', 'review', 'checks', 'docs'],
  fast: ['plan', 'build', 'checks'],
} as const;

const PASSING_ACTIONS = new Set(['advance', 'done', 'start']);

export function taskListSentence(lane: string | null): string {
  return lane === 'fast' ? TASK_LIST_SENTENCES.fast : TASK_LIST_SENTENCES.full;
}

function itemContent(item: unknown): string {
  if (typeof item === 'string') return item;
  const content =
    typeof item === 'object' && item !== null ? (item as { content?: unknown }).content : null;
  return typeof content === 'string' ? content : '';
}

export function refusesTaskList(lane: string | null, call: Record<string, unknown>): boolean {
  if (!Array.isArray(call.items)) return false;
  for (const key of ['action', 'op', 'type']) {
    const value = call[key];
    if (typeof value === 'string' && PASSING_ACTIONS.has(value.trim().toLowerCase())) return false;
  }
  const words = lane === 'fast' ? TASK_WORDS.fast : TASK_WORDS.full;
  let next = 0;
  for (const item of call.items) {
    const content = itemContent(item).trim().toLowerCase();
    if (next < words.length && content.startsWith(words[next]!)) next += 1;
  }
  return next < words.length;
}

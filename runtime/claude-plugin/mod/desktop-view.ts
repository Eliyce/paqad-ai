import { allGreenNow, changeChip } from './band';
import { formatStopwatch, formatTokens, formatUsd } from './cost';
import { needsAnswers, roleInitials, tableStatus } from './instruments';
import { stageSegments, type SegmentState } from './model';
import type { Signal } from './palette';
import { shipRail, type ShipStepState } from './ship';
import { FEATURE_ROUTE, statusEntryRoute, workflowCost, workflowWords } from './status-entry';
import type { ChiefState, Mark, SeatState, ShipState, StageState, StripInput } from './strip';
import { hasRuled, showsTable } from './table';
import { needsYou, visibilityMode, type BandVisibility } from './visibility';
import type { PaqadHudSnapshot } from './types';

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

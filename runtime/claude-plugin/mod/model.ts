// What the paqad HUD shows, from the session's snapshot (issue #639, Parts 8 and 9).
//
// Pure: no Claude Code import, so vitest tests it without the host. `parseSnapshot` reads the
// file `src/hud/snapshot.ts` writes, defensively: a missing, half-written or foreign file reads
// as `null` ("not yet") and never throws. `buildBandView` turns a snapshot into the band's
// state, headline and instruments (Stage and Ship, and the High Table from `table.ts`). Nothing here guesses: a field with no record reads
// "not yet", and a stage reads done only when the receipt would say done.

import { costPill, formatClock } from './cost';
import { tableInstrument, type TableInstrument } from './table';
import type {
  PaqadChief,
  PaqadCost,
  PaqadCostLine,
  PaqadCostTokens,
  PaqadFindingsScan,
  PaqadHighTable,
  PaqadHudSnapshot,
  PaqadHudStage,
  PaqadSeat,
  PaqadSeatState,
  PaqadTone,
  PaqadTrackRecord,
} from './types';

export const NOT_YET = 'not yet';

/** Where the session's snapshot lives under the project root, as `src/hud/files.ts` names it. */
export const HUD_DIR = '.paqad/session/hud';

/** A session id made safe for a filename, exactly as `src/hud/files.ts` does it. */
export function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

/** `root` and a relative path joined with one `/` (a root like `/` or `C:\` keeps its own). */
export function joinPath(root: string, rel: string): string {
  return /[\\/]$/.test(root) ? `${root}${rel}` : `${root}/${rel}`;
}

export function snapshotPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.json`);
}

export function receiptPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.receipt.md`);
}

// ── reading the snapshot ─────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const TONES: readonly PaqadTone[] = ['neutral', 'working', 'needs-you', 'good', 'warn', 'bad'];

function readScan(value: unknown): PaqadFindingsScan {
  const scan = rec(value);
  const status = scan?.status;
  return {
    status: status === 'open' || status === 'clean' ? status : 'did not run',
    total: num(scan?.total),
    blocking: scan?.blocking === true,
  };
}

function readTokens(value: unknown): PaqadCostTokens {
  const tokens = rec(value);
  const count = (key: string): number => Math.max(0, num(tokens?.[key]) ?? 0);
  return {
    input: count('input'),
    output: count('output'),
    cache_read: count('cache_read'),
    cache_write: count('cache_write'),
    total: count('total'),
  };
}

/** One cost line; its money is dropped when the record carries no price date (INV-10). */
function readCostLine(value: unknown, dated: boolean): PaqadCostLine {
  const line = rec(value);
  return { tokens: readTokens(line?.tokens), usd: dated ? num(line?.usd) : null };
}

/**
 * The snapshot's `cost` (Part 23), or `null` when absent or not an object. A record with no
 * price date keeps its tokens and loses its money, so money is never shown undated.
 */
function readCost(value: unknown): PaqadCost | null {
  const cost = rec(value);
  if (!cost) return null;
  const date = str(cost.price_table_date);
  const dated = date !== null;
  const chief = rec(cost.chief);
  return {
    price_table_date: date ?? '',
    label: str(cost.label) ?? 'estimate at API prices',
    basis: str(cost.basis) ?? 'API-equivalent estimate',
    plan_note: str(cost.plan_note) ?? '',
    sealed: rec(cost.window)?.sealed === true,
    tokens: readTokens(cost.tokens),
    usd: dated ? num(cost.usd) : null,
    unpriced_models: list(cost.unpriced_models).filter((m): m is string => typeof m === 'string'),
    by_stage: list(cost.by_stage).flatMap((entry) => {
      const stage = str(rec(entry)?.stage);
      return stage ? [{ stage, ...readCostLine(entry, dated) }] : [];
    }),
    by_expert: list(cost.by_expert).flatMap((entry) => {
      const role = str(rec(entry)?.role);
      return role
        ? [{ role, ...readCostLine(entry, dated), exact: rec(entry)?.exact === true }]
        : [];
    }),
    chief: chief ? { ...readCostLine(chief, dated), exact: chief.exact === true } : null,
    not_counted: list(cost.not_counted).filter((t): t is string => typeof t === 'string'),
  };
}

const SEAT_STATES: readonly PaqadSeatState[] = ['seated', 'writing', 'done'];

function strings(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === 'string');
}

/** A seat's track record, or `null` when absent or when it sat on no earlier change. */
function readTrackRecord(value: unknown): PaqadTrackRecord | null {
  const record = rec(value);
  const changes = num(record?.changes);
  if (!record || changes === null || changes <= 0) return null;
  const count = (key: string) => Math.max(0, num(record[key]) ?? 0);
  return {
    changes,
    changed_spec: count('changed_spec'),
    empty: count('empty'),
    avg_tokens: count('avg_tokens'),
  };
}

function readSeat(value: unknown): PaqadSeat | null {
  const seat = rec(value);
  const role = str(seat?.role);
  if (!seat || !role) return null;
  return {
    role,
    reason: str(seat.reason),
    origin: str(seat.origin),
    state: SEAT_STATES.find((state) => state === seat.state) ?? 'seated',
    seated_at: str(seat.seated_at),
    started_at: str(seat.started_at),
    done_at: str(seat.done_at),
    budget_tokens: num(seat.budget_tokens),
    clamped: typeof seat.clamped === 'boolean' ? seat.clamped : null,
    tokens_estimate: num(seat.tokens_estimate),
    tokens: rec(seat.tokens) ? readTokens(seat.tokens) : null,
    // Exact only when the host's usage is there to back it.
    tokens_exact: seat.tokens_exact === true && rec(seat.tokens) !== null,
    findings: num(seat.findings),
    late: seat.late === true,
    track_record: readTrackRecord(seat.track_record),
  };
}

function readChief(value: unknown): PaqadChief | null {
  const seat = readSeat(value);
  return seat ? { ...seat, verdict: str(rec(value)?.verdict) } : null;
}

/** Each entry of `value` that is an object, read by `pick`. */
function each<T>(value: unknown, pick: (entry: Rec) => T): T[] {
  return list(value).flatMap((entry) => {
    const record = rec(entry);
    return record ? [pick(record)] : [];
  });
}

/**
 * The snapshot's `table` (Parts 13 and 14), or `null` when absent or not an object. A seat with
 * no role is dropped; anything else missing reads as empty, never as a guess.
 */
function readTable(value: unknown): PaqadHighTable | null {
  const table = rec(value);
  if (!table) return null;
  const rulings = rec(table.rulings);
  const questions = rec(table.questions);
  return {
    skipped: table.skipped === true,
    met_after_freeze: table.met_after_freeze === true,
    seats: list(table.seats).flatMap((seat) => readSeat(seat) ?? []),
    chief: readChief(table.chief),
    rulings: rulings
      ? {
          accepted: strings(rulings.accepted),
          declined: each(rulings.declined, (e) => ({
            id: str(e.id) ?? '',
            reason: str(e.reason) ?? '',
          })),
          conflicts: each(rulings.conflicts, (e) => ({
            target: str(e.target) ?? '',
            recommendation: str(e.recommendation) ?? '',
            rationale: str(e.rationale) ?? '',
          })),
          renames: each(rulings.renames, (e) => ({
            id: str(e.id) ?? '',
            target: str(e.target) ?? '',
          })),
          settled: each(rulings.settled, (e) => ({
            target: str(e.target) ?? '',
            chosen: str(e.chosen) ?? '',
            source: str(e.source) ?? '',
          })),
        }
      : null,
    gaps: each(table.gaps, (e) => ({
      area: str(e.area) ?? '',
      why_it_matters: str(e.why_it_matters) ?? '',
      question: str(e.question),
    })),
    questions: questions
      ? {
          asked: num(questions.asked) ?? 0,
          auto_answered: each(questions.auto_answered, (e) => ({
            question: str(e.question) ?? '',
            source: str(e.source) ?? '',
          })),
        }
      : null,
    credits: each(table.credits, (e) => ({ line: str(e.line) ?? '', roles: strings(e.roles) })),
  };
}

/** A recorded ship step (push, PR, CI) as a short word, or `null` while nothing is recorded. */
function readStep(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const step = rec(value);
  return str(value) ?? str(step?.state) ?? str(step?.status) ?? 'recorded';
}

/**
 * Parse the snapshot file's text. Anything that is not a whole `paqad.hud/` snapshot (a missing
 * file, a half-written one, another schema) reads as `null`, never a throw.
 */
export function parseSnapshot(text: string | null | undefined): PaqadHudSnapshot | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null; // Half-written or not JSON: the band reads "not yet" until the next whole write.
  }
  const snap = rec(raw);
  if (!snap || typeof snap.schema !== 'string' || !snap.schema.startsWith('paqad.hud/')) {
    return null;
  }
  const headline = rec(snap.headline);
  const tone = TONES.find((t) => t === headline?.tone) ?? 'neutral';
  const change = rec(snap.change);
  const rules = rec(snap.rules);
  const findings = rec(snap.findings);
  const decisions = rec(snap.decisions);
  const ship = rec(snap.ship);
  const verdict = rec(snap.verdict);
  const kind = verdict?.kind;
  const lastBlock = rec(snap.last_block);
  return {
    session_id: str(snap.session_id) ?? '',
    generated_at: str(snap.generated_at) ?? '',
    active: snap.active === true,
    route: str(snap.route),
    lane: str(snap.lane),
    lane_reason: str(snap.lane_reason),
    headline: { text: str(headline?.text) ?? '', tone },
    change: change
      ? {
          id: str(change.id),
          issue: str(change.issue),
          title: str(change.title),
          branch: str(change.branch),
        }
      : null,
    paused: list(snap.paused).map((entry) => ({
      workflow: str(rec(entry)?.workflow) ?? 'unknown',
      lane: str(rec(entry)?.lane),
    })),
    stages: list(snap.stages).flatMap((entry): PaqadHudStage[] => {
      const stage = rec(entry);
      const name = str(stage?.stage);
      if (!stage || !name) return [];
      return [
        {
          stage: name,
          state: str(stage.state) ?? 'missing',
          mandatory: stage.mandatory === true,
          started_at: str(stage.started_at),
          ended_at: str(stage.ended_at),
          duration_unreliable: stage.duration_unreliable === true,
        },
      ];
    }),
    table: readTable(snap.table),
    gates: list(snap.gates).flatMap((entry) => {
      const gate = rec(entry);
      const name = str(gate?.name);
      return name ? [{ name, verdict: str(gate?.verdict) ?? 'pending' }] : [];
    }),
    flags: list(snap.flags).flatMap((entry) => {
      const flag = rec(entry);
      const id = str(flag?.id);
      return id ? [{ id, text: str(flag?.text) ?? id }] : [];
    }),
    rules: {
      recorded: rules?.recorded === true,
      applicable: num(rules?.applicable),
      loaded_at: str(rules?.loaded_at),
    },
    findings: findings
      ? { rules: readScan(findings.rules), near_copies: readScan(findings.near_copies) }
      : null,
    decisions: {
      pending: list(decisions?.pending).map((entry) => ({
        id: str(rec(entry)?.id) ?? 'unknown',
        category: str(rec(entry)?.category) ?? 'unknown',
        question: str(rec(entry)?.question) ?? '',
      })),
      resolved: num(decisions?.resolved) ?? 0,
    },
    last_block:
      snap.last_block === null || snap.last_block === undefined
        ? null
        : {
            text:
              str(snap.last_block) ??
              str(lastBlock?.text) ??
              str(lastBlock?.reason) ??
              'A rule stopped an edit.',
          },
    ship: ship
      ? {
          commits: num(ship.commits) ?? 0,
          commit_decision: str(ship.commit_decision),
          merge_commit: str(ship.merge_commit),
          push: readStep(ship.push),
          pr: readStep(ship.pr),
          ci: readStep(ship.ci),
        }
      : null,
    verdict:
      verdict && (kind === 'pass' || kind === 'fail' || kind === 'inconclusive')
        ? {
            word: str(verdict.word) ?? VERDICT_WORDS[kind],
            kind,
            reasons: list(verdict.reasons).filter((r): r is string => typeof r === 'string'),
          }
        : null,
    cost: readCost(snap.cost),
  };
}

// ── the nine states ───────────────────────────────────────────────────────────

/** The verdict words, exactly as paqad speaks them everywhere. */
export const VERDICT_WORDS = {
  pass: 'Safe to merge',
  fail: 'Needs your attention',
  inconclusive: 'Inconclusive',
} as const;

export const BAND_STATES = [
  'Ready',
  'Working',
  'Branch warning',
  'Needs you',
  'Stopped',
  'Inconclusive',
  'Safe to merge',
  'Needs your attention',
  'Paused',
] as const;

export type BandState = (typeof BAND_STATES)[number];

const STATE_TONE: Record<BandState, PaqadTone> = {
  Ready: 'neutral',
  Working: 'working',
  'Branch warning': 'warn',
  'Needs you': 'needs-you',
  Stopped: 'bad',
  Inconclusive: 'warn',
  'Safe to merge': 'good',
  'Needs your attention': 'bad',
  Paused: 'neutral',
};

/** True when a flag warns about the branch (other tickets' commits riding along, Part 22). */
function isBranchFlag(flag: { id: string }): boolean {
  return flag.id.startsWith('branch');
}

/**
 * The band's state, first match wins:
 *   1. Needs you: a decision is waiting.
 *   2. Stopped: a rule stopped an edit (`last_block`, Part 18).
 *   3. No change in progress: Paused when one is paused, Working on another workflow, else Ready.
 *   4. Branch warning: a branch flag is open on the change (Part 22).
 *   5. Working: a stage is running.
 *   6. The verdict: Safe to merge, Needs your attention or Inconclusive.
 *   7. Working: the change goes on, no verdict yet.
 * No snapshot at all reads Ready ("not yet").
 */
export function bandState(snapshot: PaqadHudSnapshot | null): BandState {
  if (!snapshot) return 'Ready';
  if (snapshot.decisions.pending.length > 0) return 'Needs you';
  if (snapshot.last_block) return 'Stopped';
  if (!snapshot.active) {
    if (snapshot.paused.length > 0) return 'Paused';
    if (snapshot.route && snapshot.route !== 'no-workflow') return 'Working';
    return 'Ready';
  }
  if (snapshot.flags.some(isBranchFlag)) return 'Branch warning';
  if (snapshot.stages.some((stage) => stage.state === 'running')) return 'Working';
  if (snapshot.verdict) return VERDICT_WORDS[snapshot.verdict.kind];
  return 'Working';
}

/**
 * The band's colour. Any open flag turns it amber, even at Safe to merge (decision 17); red and
 * "needs you" keep their own colour, since they already ask for more than a flag does.
 */
export function bandTone(state: BandState, flags: number): PaqadTone {
  const tone = STATE_TONE[state];
  if (flags > 0 && (tone === 'good' || tone === 'working' || tone === 'neutral')) return 'warn';
  return tone;
}

// ── the Stage instrument ──────────────────────────────────────────────────────

export const STAGE_ORDER = [
  ['ticket_intake', 'Intake'],
  ['planning', 'Planning'],
  ['specification', 'Spec'],
  ['development', 'Build'],
  ['review', 'Review'],
  ['checks', 'Checks'],
  ['documentation_sync', 'Docs'],
  ['delivery', 'Deliver'],
] as const;

/** A stage id in the band's words; `orchestrator` is the time between stages. */
export function stageLabel(stage: string): string {
  if (stage === 'orchestrator') return 'Between stages';
  return STAGE_ORDER.find(([id]) => id === stage)?.[1] ?? stage;
}

export type SegmentState = 'done' | 'running' | 'marked' | 'failed' | 'not required' | 'not yet';

export interface StageSegment {
  stage: string;
  label: string;
  state: SegmentState;
  /** The running stage's start, for the live clock. */
  started_at: string | null;
}

/**
 * True when the checks a `checks` stage claims are backed by a passing tests-and-lint gate. The
 * receipt reads an unbacked `checks` stage as "tests not verified", never done (issue #368).
 */
function checksBacked(snapshot: PaqadHudSnapshot): boolean {
  return snapshot.gates.some((gate) => gate.name === 'code-tests-lint' && gate.verdict === 'pass');
}

/**
 * One stage's segment. Honest by construction: done only when the receipt would print done, so
 * the band never shows a stage as done that the receipt does not (AC-45).
 */
function segmentState(stage: PaqadHudStage | undefined, snapshot: PaqadHudSnapshot): SegmentState {
  if (!stage) return NOT_YET;
  switch (stage.state) {
    case 'complete':
    case 'redone':
      if (stage.duration_unreliable) return 'marked';
      if (stage.stage === 'checks' && !checksBacked(snapshot)) return 'marked';
      return 'done';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'inconclusive':
      return 'marked';
    case 'skipped':
    case 'not-applicable':
      return 'not required';
    default:
      // The fast lane needs no frozen spec, so Spec reads "not required" there (decision 12).
      if (stage.stage === 'specification' && snapshot.lane === 'fast') return 'not required';
      return NOT_YET;
  }
}

export function stageSegments(snapshot: PaqadHudSnapshot | null): StageSegment[] {
  return STAGE_ORDER.map(([stage, label]) => {
    const record = snapshot?.stages.find((entry) => entry.stage === stage);
    return {
      stage,
      label,
      state: snapshot && snapshot.active ? segmentState(record, snapshot) : NOT_YET,
      started_at: record?.started_at ?? null,
    };
  });
}

export { formatClock };

/** The running stage's live clock, or `null` when nothing runs or its start is unreadable. */
export function liveClock(segments: StageSegment[], now: number): string | null {
  const running = segments.find((segment) => segment.state === 'running');
  const started = running?.started_at ? Date.parse(running.started_at) : Number.NaN;
  return Number.isFinite(started) ? formatClock(now - started) : null;
}

// ── the Ship instrument ───────────────────────────────────────────────────────

export interface ShipStep {
  label: 'Edit' | 'Commit' | 'Push' | 'PR' | 'CI' | 'Merge';
  /** What the step says in words: `done`, `running`, `3 commits`, `not yet`, `stays yours`. */
  word: string;
  done: boolean;
}

export function shipSteps(snapshot: PaqadHudSnapshot | null): ShipStep[] {
  const active = snapshot?.active === true;
  const build = snapshot?.stages.find((stage) => stage.stage === 'development');
  const edit: ShipStep =
    active && build?.state === 'running'
      ? { label: 'Edit', word: 'running', done: false }
      : active && (build?.state === 'complete' || build?.state === 'redone')
        ? { label: 'Edit', word: 'done', done: true }
        : { label: 'Edit', word: NOT_YET, done: false };
  const ship = active ? (snapshot?.ship ?? null) : null;
  const commits = ship?.commits ?? 0;
  const step = (label: 'Push' | 'PR' | 'CI', value: string | null | undefined): ShipStep =>
    value ? { label, word: value, done: true } : { label, word: NOT_YET, done: false };
  return [
    edit,
    commits > 0
      ? { label: 'Commit', word: `${commits} commit${commits === 1 ? '' : 's'}`, done: true }
      : { label: 'Commit', word: NOT_YET, done: false },
    step('Push', ship?.push),
    step('PR', ship?.pr),
    step('CI', ship?.ci),
    // paqad never merges for you (decision 2): Merge stays yours until a merge is recorded.
    ship?.merge_commit
      ? { label: 'Merge', word: 'merged', done: true }
      : { label: 'Merge', word: 'stays yours', done: false },
  ];
}

// ── the band's view ───────────────────────────────────────────────────────────

export interface BandView {
  state: BandState;
  tone: PaqadTone;
  headline: string;
  /** Open flags (rule findings and near-copies count here, as flags, never as an instrument). */
  flags: number;
  stages: StageSegment[];
  clock: string | null;
  ship: ShipStep[];
  /** The cost pill (Part 23): tokens and a dated money estimate, or "cost: not yet". */
  cost: string;
  /**
   * The High Table instrument (Part 14), or `null` when the band has none: the fast lane, the
   * experts off, or no change in progress.
   */
  table: TableInstrument | null;
}

/**
 * The headline with the state's own word taken off its front, so the band and `/paqad` say the
 * state once ("Safe to merge. 1 flag open." after the state "Safe to merge" reads "1 flag open.").
 */
export function headlineAfterState(view: Pick<BandView, 'state' | 'headline'>): string {
  return view.headline.startsWith(view.state)
    ? view.headline.slice(view.state.length).replace(/^[.:]\s*/, '')
    : view.headline;
}

export function flagPill(flags: number): string | null {
  return flags > 0 ? `${flags} flag${flags === 1 ? '' : 's'}` : null;
}

export { costPill };

export function buildBandView(snapshot: PaqadHudSnapshot | null, now: number): BandView {
  const state = bandState(snapshot);
  const flags = snapshot?.flags.length ?? 0;
  const stages = stageSegments(snapshot);
  return {
    state,
    tone: bandTone(state, flags),
    headline: snapshot?.headline.text || 'Not yet. paqad has no record for this session.',
    flags,
    stages,
    clock: liveClock(stages, now),
    ship: shipSteps(snapshot),
    cost: costPill(snapshot?.cost ?? null),
    table: tableInstrument(snapshot),
  };
}

/** True while the band has something live to tick: a stage is running. */
export function isLive(snapshot: PaqadHudSnapshot | null): boolean {
  return snapshot?.active === true && snapshot.stages.some((stage) => stage.state === 'running');
}

/** True for a running stage agent as `$.agent.list()` names it (`paqad:paqad-<stage>`). */
export function isStageAgent(agent: { type?: unknown; status?: unknown }): boolean {
  return (
    typeof agent.type === 'string' &&
    /^(paqad:)?paqad-/.test(agent.type) &&
    (agent.status === 'running' || agent.status === 'pending' || agent.status === 'waiting')
  );
}

/** True for a finished tool call that may have moved paqad's records, so the band refreshes. */
export function isRefreshTool(tool: string, input: { command?: unknown }): boolean {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return true;
  if (tool === 'Agent' || tool === 'Task') return true;
  return tool === 'Bash' && typeof input.command === 'string' && input.command.includes('paqad-ai');
}

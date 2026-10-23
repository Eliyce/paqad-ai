import { verdictFromEarlierTurn, waitingOnHuman } from './attention';
import { costPill, formatClock } from './cost';
import { IDLE_LIVE, type LiveState } from './live';
import { tableInstrument, type TableInstrument } from './table';
import type {
  PaqadChief,
  PaqadCi,
  PaqadClaim,
  PaqadCommitGroup,
  PaqadCost,
  PaqadCostLine,
  PaqadCostTokens,
  PaqadDeliveryPlan,
  PaqadFindingsScan,
  PaqadGate,
  PaqadGateStrength,
  PaqadHighTable,
  PaqadHudSnapshot,
  PaqadHudStage,
  PaqadLastBlock,
  PaqadPlanProgress,
  PaqadPrState,
  PaqadScope,
  PaqadSeat,
  PaqadShipCommit,
  PaqadSeatState,
  PaqadTone,
  PaqadTimelineEntry,
  PaqadTrackRecord,
  PaqadWorkflow,
} from './types';

export const NOT_YET = 'not yet';

export const HUD_DIR = '.paqad/session/hud';

export function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

export function joinPath(root: string, rel: string): string {
  return /[\\/]$/.test(root) ? `${root}${rel}` : `${root}/${rel}`;
}

export function snapshotPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.json`);
}

export function receiptPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.receipt.md`);
}

export function lastBlockPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.last-block.json`);
}

export const PENDING_DECISIONS_DIR = '.paqad/decisions/pending';

export function entrySentinelPath(root: string, sessionId: string): string {
  const key = sessionId.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return joinPath(
    root,
    key === '' ? '.paqad/.agent-entry-loaded' : `.paqad/.agent-entry-loaded.d/${key}`,
  );
}

export function heartbeatPath(root: string, sessionId: string): string {
  return joinPath(root, `${HUD_DIR}/${safeSessionId(sessionId)}.live`);
}

export const ORG_ENFORCED = "This rule is enforced by your organization's settings.";

export const RULE_STOP_FIX = 'Let Claude fix it';
export const RULE_STOP_ALLOW = 'Allow once, recorded';
export const RULE_STOP_SHOW = 'Show the rule';
export const RULE_STOP_NO_REASON = 'No reason';
export const RULE_STOP_FALSE_POSITIVE = 'It is a false positive';
export const RULE_STOP_HEADER = 'Rule stop';
export const RULE_STOP_REASON_HEADER = 'Reason';

export const OWN_QUESTION_HEADERS: readonly string[] = [RULE_STOP_HEADER, RULE_STOP_REASON_HEADER];

export interface RuleStop {
  rule: string;
  title: string | null;
  file: string;
  toolUseId: string;
  managed: boolean;
  sole: boolean;
  token: string;
}

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

function readLastBlock(raw: unknown, block: Rec | null): PaqadLastBlock {
  const rule = str(block?.rule);
  const file = str(block?.file);
  const text =
    str(raw) ??
    str(block?.text) ??
    str(block?.reason) ??
    (rule && file ? `${rule} stopped an edit to ${file}.` : 'A rule stopped an edit.');
  const title = str(block?.title);
  const toolUseId = str(block?.tool_use_id);
  const at = str(block?.at);
  const token = str(block?.token);
  return {
    text,
    ...(rule ? { rule } : {}),
    ...(title ? { title } : {}),
    ...(file ? { file } : {}),
    ...(toolUseId ? { tool_use_id: toolUseId } : {}),
    ...(typeof block?.managed === 'boolean' ? { managed: block.managed } : {}),
    ...(at ? { at } : {}),
    ...(token ? { token } : {}),
    ...(typeof block?.used === 'boolean' ? { used: block.used } : {}),
  };
}

export function freshRuleStop(
  text: string | null,
  sessionId: string,
  toolUseId: string | undefined,
): RuleStop | null {
  if (text === null || !toolUseId) return null;
  let raw: Rec | null;
  try {
    raw = rec(JSON.parse(text));
  } catch {
    return null;
  }
  const rule = str(raw?.rule);
  const file = str(raw?.file);
  const token = str(raw?.token);
  if (!raw || !rule || !file || !token) return null;
  if (raw.used === true || str(raw.session) !== sessionId) return null;
  if (str(raw.tool_use_id) !== toolUseId) return null;
  return {
    rule,
    title: str(raw.title),
    file,
    toolUseId,
    managed: raw.managed === true,
    sole: raw.sole === true,
    token,
  };
}

export function ruleStopQuestion(stop: RuleStop): string {
  return `${stop.rule} stopped this edit to ${stop.file}. What should happen?`;
}

export function ruleTextQuestion(stop: RuleStop): string {
  return `${stop.rule}: ${stop.title ?? 'no rule text recorded'}. What should happen?`;
}

export function overrideArgs(
  stop: RuleStop,
  sessionId: string,
  root: string,
  reason: string | null,
): string[] {
  return [
    '--rule',
    stop.rule,
    '--file',
    stop.file,
    '--token',
    stop.token,
    '--tool-use-id',
    stop.toolUseId,
    '--session',
    sessionId,
    '--project-root',
    root,
    ...(reason ? [`--reason=${reason}`] : []),
  ];
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

function readCostLine(value: unknown, dated: boolean): PaqadCostLine {
  const line = rec(value);
  return { tokens: readTokens(line?.tokens), usd: dated ? num(line?.usd) : null };
}

function readCost(value: unknown): PaqadCost | null {
  const cost = rec(value);
  if (!cost) return null;
  const date = str(cost.price_table_date);
  const dated = date !== null;
  const chief = rec(cost.chief);
  return {
    scope: cost.scope === 'change' ? 'change' : 'whole-session',
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
    live: cost.live === true,
  };
}

const SEAT_STATES: readonly PaqadSeatState[] = ['seated', 'writing', 'done'];

function strings(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === 'string');
}

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

function each<T>(value: unknown, pick: (entry: Rec) => T): T[] {
  return list(value).flatMap((entry) => {
    const record = rec(entry);
    return record ? [pick(record)] : [];
  });
}

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

function readStep(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const step = rec(value);
  return str(value) ?? str(step?.state) ?? str(step?.status) ?? 'recorded';
}

function readPr(value: unknown): string | null {
  const pr = rec(value);
  const number = num(pr?.number);
  if (number === null) return readStep(value);
  return `${pr?.draft === true ? 'draft ' : ''}#${number}`;
}

function readCi(value: unknown): string | null {
  const ci = rec(value);
  const total = num(ci?.total);
  if (ci?.state === 'pending' && total !== null) return `${num(ci.done) ?? 0} of ${total} done`;
  return readStep(value);
}

function readCiDetail(value: unknown): PaqadCi | null {
  const ci = rec(value);
  const state = str(ci?.state);
  if (!ci || !state) return null;
  return {
    state,
    done: num(ci.done),
    total: num(ci.total),
    reason: str(ci.reason),
    jobs: each(ci.jobs, (job) => ({
      name: str(job.name) ?? 'check',
      status: str(job.status),
      conclusion: str(job.conclusion),
      started_at: str(job.started_at),
      completed_at: str(job.completed_at),
    })),
  };
}

function readShipCommits(value: unknown): PaqadShipCommit[] {
  return each(value, (commit) => ({
    sha: str(commit.sha) ?? '',
    subject: str(commit.subject) ?? '',
    own: typeof commit.own === 'boolean' ? commit.own : null,
  })).filter((commit) => commit.sha !== '');
}

const PR_STATES: readonly PaqadPrState[] = ['open', 'merged', 'closed'];

function readPrState(value: unknown): PaqadPrState | null {
  return PR_STATES.find((state) => state === value) ?? null;
}

function readScope(value: unknown): PaqadScope {
  const scope = rec(value);
  return {
    qualified: scope?.qualified === true,
    reason: str(scope?.reason) ?? 'no scope recorded',
  };
}

function readWorkflow(value: unknown): PaqadWorkflow | null {
  const workflow = rec(value);
  const name = str(workflow?.name);
  if (!workflow || !name) return null;
  return {
    name,
    started_at: str(workflow.started_at),
    tokens: num(workflow.tokens),
    usd: num(workflow.usd),
    unpriced: strings(workflow.unpriced),
  };
}

const GATE_STRENGTHS: readonly PaqadGateStrength[] = ['deterministic', 'llm-judged'];

function readGate(value: unknown): PaqadGate | null {
  const gate = rec(value);
  const name = str(gate?.name);
  if (!gate || !name) return null;
  const verdict = str(gate.verdict) ?? 'pending';
  return {
    name,
    verdict,
    required: typeof gate.required === 'boolean' ? gate.required : verdict !== 'not-required',
    strength: GATE_STRENGTHS.find((strength) => strength === gate.strength) ?? null,
  };
}

function readClaim(value: unknown): PaqadClaim | null {
  const claim = rec(value);
  const kind = str(claim?.kind);
  if (!claim || !kind) return null;
  return {
    kind,
    id: str(claim.id),
    label: str(claim.label) ?? kind,
    verdict: str(claim.verdict) ?? 'inconclusive',
    test_id: str(claim.test_id),
  };
}

const TIMELINE_TEXT = [
  'agent',
  'verdict',
  'title',
  'issue',
  'lane',
  'sha',
  'subject',
  'state',
] as const;

const TIMELINE_COUNTS = [
  'duration_ms',
  'count',
  'picked',
  'standing',
  'findings',
  'number',
  'requirements',
  'criteria',
] as const;

function readTimelineEntry(entry: Record<string, unknown>): PaqadTimelineEntry {
  const read: PaqadTimelineEntry = {
    at: str(entry.at) ?? '',
    kind: str(entry.kind) ?? 'unknown',
    stage: str(entry.stage),
    note: str(entry.note),
  };
  for (const key of TIMELINE_TEXT) {
    const value = str(entry[key]);
    if (value !== null) read[key] = value;
  }
  for (const key of TIMELINE_COUNTS) {
    const value = num(entry[key]);
    if (value !== null) read[key] = value;
  }
  if (typeof entry.own_agent === 'boolean') read.own_agent = entry.own_agent;
  return read;
}

function readDeliveryPlan(value: unknown): PaqadDeliveryPlan | null {
  const plan = rec(value);
  if (!plan) return null;
  const { commit, push, pr, ci, merge } = plan;
  if (![commit, push, pr, ci, merge].every((step) => typeof step === 'boolean')) return null;
  return {
    commit: commit === true,
    push: push === true,
    pr: pr === true,
    ci: ci === true,
    merge: merge === true,
    reason: str(plan.reason),
  };
}

export const STAGE_TIMELINE_KINDS: ReadonlySet<string> = new Set([
  'open',
  'close',
  'stage_start',
  'stage_end',
]);

export function fixProofClaims(snapshot: PaqadHudSnapshot): PaqadClaim[] {
  return snapshot.claims.filter((claim) => claim.kind === 'fix-proof');
}

function readPlan(value: unknown): PaqadPlanProgress | null {
  const plan = rec(value);
  const steps = num(plan?.steps);
  const done = num(plan?.done);
  return steps !== null && steps > 0 && done !== null ? { steps, done } : null;
}

function readBundleFiles(value: unknown): string[] {
  return each(value, (entry) => (entry.present === true ? str(entry.file) : null)).filter(
    (file): file is string => file !== null,
  );
}

function readCommitGroup(value: unknown): PaqadCommitGroup | null {
  const group = rec(value);
  if (!group) return null;
  return {
    count: num(group.count) ?? 0,
    tickets: strings(group.tickets),
    merges: num(group.merges) ?? 0,
    untagged: num(group.untagged) ?? 0,
  };
}

export function parseSnapshot(text: string | null | undefined): PaqadHudSnapshot | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
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
  const writtenAt = str(verdict?.written_at);
  const receiptFile = str(rec(snap.receipt)?.path);
  const scope = readScope(snap.scope);
  const parsed: PaqadHudSnapshot = {
    session_id: str(snap.session_id) ?? '',
    generated_at: str(snap.generated_at) ?? '',
    scope,
    workflow: readWorkflow(snap.workflow),
    active: snap.active === true && scope.qualified,
    route: str(snap.route),
    lane: str(snap.lane),
    ...(Array.isArray(snap.lane_stages)
      ? { lane_stages: list(snap.lane_stages).filter((s): s is string => typeof s === 'string') }
      : {}),
    lane_reason: str(snap.lane_reason),
    headline: { text: str(headline?.text) ?? '', tone },
    change: change
      ? {
          dir: str(change.dir),
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
          duration_ms: num(stage.duration_ms),
          agent: str(stage.agent),
        },
      ];
    }),
    timeline: each(snap.timeline, readTimelineEntry).filter((entry) => entry.at !== ''),
    table: readTable(snap.table),
    gates: list(snap.gates).flatMap((entry) => readGate(entry) ?? []),
    gates_expected: strings(snap.gates_expected),
    claims: list(snap.claims).flatMap((entry) => readClaim(entry) ?? []),
    bundle_files: readBundleFiles(snap.evidence_expected),
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
        : readLastBlock(snap.last_block, lastBlock),
    delivery_plan: readDeliveryPlan(snap.delivery_plan),
    plan: readPlan(snap.plan),
    ship: ship
      ? {
          commits: num(ship.commits) ?? 0,
          commit_decision: str(ship.commit_decision),
          merge_commit: str(ship.merge_commit),
          push: readStep(ship.push),
          pr: readPr(ship.pr),
          ci: readCi(ship.ci),
          push_branch: str(rec(ship.push)?.branch),
          pr_url: str(rec(ship.pr)?.url),
          ci_detail: readCiDetail(ship.ci),
          own: readCommitGroup(ship.own),
          inherited: readCommitGroup(ship.inherited),
          commit_list: readShipCommits(ship.commit_list),
          inherited_count: num(ship.inherited_count) ?? 0,
          pr_number: num(rec(ship.pr)?.number),
          pr_state: readPrState(ship.pr_state),
          pr_head: str(rec(ship.pr)?.head_sha),
          pr_title: str(ship.pr_title),
          pr_files: num(ship.pr_files),
          pr_additions: num(ship.pr_additions),
          pr_deletions: num(ship.pr_deletions),
          files_changed: num(ship.files_changed),
          ci_read_at: str(ship.ci_read_at),
          all_green: ship.all_green === true,
          merged: ship.merged === true,
        }
      : null,
    verdict:
      verdict && (kind === 'pass' || kind === 'fail' || kind === 'inconclusive')
        ? {
            word: str(verdict.word) ?? VERDICT_WORDS[kind],
            kind,
            reasons: list(verdict.reasons).filter((r): r is string => typeof r === 'string'),
            ...(writtenAt ? { at: writtenAt } : {}),
          }
        : null,
    receipt: receiptFile ? { path: receiptFile } : null,
    cost: readCost(snap.cost),
  };
  return scope.qualified ? parsed : idleSnapshot(parsed);
}

function idleSnapshot(snapshot: PaqadHudSnapshot): PaqadHudSnapshot {
  return {
    ...snapshot,
    active: false,
    change: null,
    stages: [],
    timeline: [],
    table: null,
    gates: [],
    claims: [],
    bundle_files: [],
    flags: [],
    findings: null,
    decisions: { pending: [], resolved: 0 },
    plan: null,
    ship: null,
    verdict: null,
    receipt: null,
    cost: null,
  };
}

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
  Inconclusive: 'warn',
  'Safe to merge': 'good',
  'Needs your attention': 'bad',
  Paused: 'neutral',
};

function isBranchFlag(flag: { id: string }): boolean {
  return flag.id.startsWith('branch');
}

export function bandState(
  snapshot: PaqadHudSnapshot | null,
  live: LiveState = IDLE_LIVE,
): BandState {
  if (!snapshot) return 'Ready';
  if (waitingOnHuman(snapshot, live)) return 'Needs you';
  if (!snapshot.active) {
    if (snapshot.paused.length > 0) return 'Paused';
    if (snapshot.route && snapshot.route !== 'no-workflow') return 'Working';
    return 'Ready';
  }
  if (snapshot.flags.some(isBranchFlag)) return 'Branch warning';
  if (snapshot.stages.some((stage) => stage.state === 'running')) return 'Working';
  if (snapshot.verdict && !verdictFromEarlierTurn(snapshot, live)) {
    return VERDICT_WORDS[snapshot.verdict.kind];
  }
  return 'Working';
}

export function bandTone(state: BandState, flags: number): PaqadTone {
  const tone = STATE_TONE[state];
  if (flags > 0 && (tone === 'good' || tone === 'working' || tone === 'neutral')) return 'warn';
  return tone;
}

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

export function stageLabel(stage: string): string {
  if (stage === 'orchestrator') return 'Between stages';
  return STAGE_ORDER.find(([id]) => id === stage)?.[1] ?? stage;
}

export type SegmentState = 'done' | 'running' | 'marked' | 'failed' | 'not required' | 'not yet';

export interface StageSegment {
  stage: string;
  label: string;
  state: SegmentState;
  started_at: string | null;
}

function checksBacked(snapshot: PaqadHudSnapshot): boolean {
  return snapshot.gates.some((gate) => gate.name === 'code-tests-lint' && gate.verdict === 'pass');
}

const MANDATORY_STAGE_IDS = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

function outsideLane(stage: string, snapshot: PaqadHudSnapshot): boolean {
  if (!MANDATORY_STAGE_IDS.includes(stage)) return false;
  if (snapshot.lane_stages) return !snapshot.lane_stages.includes(stage);
  return stage === 'specification' && snapshot.lane === 'fast';
}

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
      if (outsideLane(stage.stage, snapshot)) return 'not required';
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

export function liveClock(segments: StageSegment[], now: number): string | null {
  const running = segments.find((segment) => segment.state === 'running');
  const started = running?.started_at ? Date.parse(running.started_at) : Number.NaN;
  return Number.isFinite(started) ? formatClock(now - started) : null;
}

export interface BandView {
  state: BandState;
  tone: PaqadTone;
  headline: string;
  flags: number;
  stages: StageSegment[];
  clock: string | null;
  cost: string;
  table: TableInstrument | null;
}

export function headlineAfterState(view: Pick<BandView, 'state' | 'headline'>): string {
  return view.headline.startsWith(view.state)
    ? view.headline.slice(view.state.length).replace(/^[.:]\s*/, '')
    : view.headline;
}

export function flagPill(flags: number): string | null {
  return flags > 0 ? `${flags} flag${flags === 1 ? '' : 's'}` : null;
}

export { costPill };

export function buildBandView(
  snapshot: PaqadHudSnapshot | null,
  now: number,
  live: LiveState = IDLE_LIVE,
): BandView {
  const state = bandState(snapshot, live);
  const flags = snapshot?.flags.length ?? 0;
  const stages = stageSegments(snapshot);
  return {
    state,
    tone: bandTone(state, flags),
    headline: snapshot?.headline.text || 'Not yet. paqad has no record for this session.',
    flags,
    stages,
    clock: liveClock(stages, now),
    cost: costPill(snapshot?.cost ?? null),
    table: tableInstrument(snapshot),
  };
}

export function isLive(snapshot: PaqadHudSnapshot | null): boolean {
  return snapshot?.active === true && snapshot.stages.some((stage) => stage.state === 'running');
}

export function isStageAgent(agent: { type?: unknown; status?: unknown }): boolean {
  return (
    typeof agent.type === 'string' &&
    /^(paqad:)?paqad-/.test(agent.type) &&
    (agent.status === 'running' || agent.status === 'pending' || agent.status === 'waiting')
  );
}

export function isRefreshTool(tool: string, input: { command?: unknown }): boolean {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return true;
  if (tool === 'Agent' || tool === 'Task') return true;
  return tool === 'Bash' && typeof input.command === 'string' && input.command.includes('paqad-ai');
}

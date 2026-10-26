import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { readContractDecisions, type StoredContractDecision } from '@/decisions/authoring.js';
import { readAnyDecisionPacket } from '@/decisions/packet-shape.js';
import {
  FIX_PROOF_STATE_LABEL,
  foldFixProofState,
  readFixProofRows,
  type FixProofState,
} from '@/fix-protocol/fix-proof-record.js';
import { readFeatureChecks } from '@/checks/report-store.js';
import {
  readDuplication,
  readFeatureEvidence,
  readRuleRun,
  type DuplicationRowFinding,
  type RuleRunFinding,
} from '@/feature-evidence/bundle-ledgers.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { type CommitGroup, type CommitSplit } from '@/delivery/commit-split.js';
import {
  readChangeStartPoint,
  readFeatureDelivery,
  type ChangeStartSource,
  type DeliveryCi,
  type DeliveryPr,
  type DeliveryPrState,
  type DeliveryPush,
  type DeliveryRecord,
} from '@/feature-evidence/delivery.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { BUNDLE_MANIFEST, isBundleFileRequired } from '@/feature-evidence/manifest.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import {
  featureChangeKey,
  featureDir,
  featureFilePath,
  parseFeatureDirName,
} from '@/feature-evidence/paths.js';
import { readRuleOverrides } from '@/feature-evidence/rule-overrides.js';
import { readRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import {
  readFeatureTechDebtIndex,
  type TechDebtIndexEntry,
} from '@/feature-evidence/tech-debt-index.js';
import { foldFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { workflowCostSince } from '@/cost/session-cost.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { ResolvedDeliveryPolicy } from '@/core/types/delivery-policy.js';
import { LANES } from '@/core/types/routing.js';
import { buildChangeTraceabilityMap } from '@/traceability/change-map.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { episodeStart, readRouteTurns } from '@/pipeline/route-turns.js';
import type { RoutedWorkflow } from '@/pipeline/routed-workflow.js';
import { readWorkflowState, type WorkflowState } from '@/pipeline/workflow-state.js';
import { readLedgerSessionId, resolveSessionId } from '@/rag-ledger/session.js';
import { aggregateSpecPipelineMetrics } from '@/spec-pipeline/metrics.js';
import { isLaneStage, laneStages } from '@/stage-evidence/stages.js';
import { RECORD_REPAIR_KIND, type FoldedChange } from '@/stage-evidence/types.js';
import { summarizeStageIsolation } from '@/stage-isolation/isolation-summary.js';
import { stageForAgentName, stripPluginAgentNamespace } from '@/stage-isolation/stage-agents.js';
import {
  buildBundleCompletenessConfig,
  stageIsolationStatus,
} from '@/verification/repository/bundle-completeness-config.js';
import {
  VERIFICATION_GATES,
  gateCatalogEntry,
  gateExpectedOnLane,
  type GateOwner,
} from '@/core/types/verification.js';
import { LANE_RECORD_GAP } from '@/verification/verdict-kind.js';

import {
  gateIsJudged,
  latestEditAt,
  latestStageMoveAt,
  qualifyHudChange,
  stageEndTimes,
  type HudScopeReason,
} from './change-scope.js';
import { readChangeGit, readWorkingTreeDirty } from './changed-files.js';
import {
  computeDoneLadder,
  type DoneLadder,
  type HudRung,
  type LadderChecks,
} from './done-ladder.js';
import { buildHudCost, type HudCost } from './cost-view.js';
import { hudReceiptPath, hudSnapshotPath, hudVerdictPath, writeFileAtomic } from './files.js';
import { buildHighTableView, type HudHighTable, type HudTrackRecord } from './high-table-view.js';
import { readRuleStopRecord, type RuleStopRecord } from './last-block.js';
import type { HudVerdictRecord } from './receipt-file.js';
import { buildStageProof, readStageProofEvidence, type HudStageProof } from './stage-proof.js';

export const HUD_SNAPSHOT_SCHEMA = 'paqad.hud/3';

export type HudTone = 'neutral' | 'working' | 'needs-you' | 'good' | 'warn' | 'bad';

export interface HudStage {
  stage: string;
  state: string;
  mandatory: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  duration_unreliable: boolean;
  agent: string | null;
  proof_file: string | null;
}

export type HudGateVerdict =
  'pass' | 'fail' | 'inconclusive' | 'not-required' | 'did-not-run' | 'pending' | 'not-judged';

export interface HudGate {
  name: string;
  required: boolean;
  strength: 'deterministic' | 'llm-judged' | null;
  verdict: HudGateVerdict;
  owner?: GateOwner;
}

export interface HudFlag {
  id: string;
  text: string;
}

export type { HudChief, HudHighTable, HudSeat, HudTrackRecord } from './high-table-view.js';
export type { HudCost } from './cost-view.js';
export type { HudScopeReason } from './change-scope.js';
export type { HudRung } from './done-ladder.js';
export type { HudProofGate, HudProofStep, HudStageProof } from './stage-proof.js';

export type HudFindingsStatus = 'open' | 'clean' | 'did not run';

export interface HudFindingsScan<T> {
  status: HudFindingsStatus;
  total: number | null;
  counts: Record<string, number> | null;
  blocking: boolean;
  from_cache: boolean;
  items: T[] | null;
  overflow: number;
  recorded_at: string | null;
}

export interface HudFindings {
  rules: HudFindingsScan<RuleRunFinding>;
  near_copies: HudFindingsScan<DuplicationRowFinding>;
}

export interface HudTimelineEntry {
  at: string;
  kind: string;
  stage: string | null;
  note: string | null;
  agent?: string | null;
  own_agent?: boolean;
  duration_ms?: number | null;
  count?: number;
  picked?: number;
  standing?: number;
  findings?: number;
  verdict?: string | null;
  title?: string | null;
  issue?: string | null;
  decision?: string;
  lane?: string | null;
  sha?: string;
  subject?: string;
  number?: number;
  requirements?: number;
  criteria?: number;
  state?: string;
}

export const TIMELINE_ROWS = 20;
export const TIMELINE_COMMITS = 10;

const TIMELINE_KINDS: ReadonlySet<string> = new Set(['open', 'close', 'stage_start', 'stage_end']);

export interface TimelineChange {
  title: string | null;
  issue: string | null;
  lane: string | null;
}

function isTime(value: string | null | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function spanMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!isTime(from) || !isTime(to)) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 ? ms : null;
}

function inOrder(times: ReadonlyArray<string | null | undefined>): string[] {
  return times.filter(isTime).sort((a, b) => Date.parse(a) - Date.parse(b));
}

function stageEndDuration(
  rows: readonly Record<string, unknown>[],
  index: number,
  stage: string | null,
): number | null {
  const start = rows
    .slice(0, index)
    .reverse()
    .find((row) => row.kind === 'stage_start' && str(row.stage) === stage);
  return start ? spanMs(rowRecordedAt(start), rowRecordedAt(rows[index]!)) : null;
}

function startedInOwnAgent(agent: string | null, stage: string | null): boolean {
  return (
    agent !== null &&
    stage !== null &&
    stageForAgentName(stripPluginAgentNamespace(agent)) === stage
  );
}

export function buildTimeline(
  projectRoot: string,
  dirName: string,
  change: TimelineChange | null = null,
): HudTimelineEntry[] {
  const rows = readFeatureStageUnit(projectRoot, dirName) as unknown as Record<string, unknown>[];
  const entries: HudTimelineEntry[] = [];
  rows.forEach((row, index) => {
    const kind = String(row.kind);
    const at = rowRecordedAt(row);
    if (!TIMELINE_KINDS.has(kind) || !at) return;
    const stage = str(row.stage);
    const entry: HudTimelineEntry = { at, kind, stage, note: str(row.note) };
    if (kind === 'open' && entry.note === null && change) Object.assign(entry, change);
    if (kind === 'stage_start') {
      entry.agent = str(row.agent);
      entry.own_agent = startedInOwnAgent(entry.agent, stage);
    }
    if (kind === 'stage_end') entry.duration_ms = stageEndDuration(rows, index, stage);
    entries.push(entry);
  });
  return entries.slice(-TIMELINE_ROWS);
}

export interface RecordEventSources {
  rulesLoaded: { recorded_at?: string | null; applicable_rules?: readonly unknown[] } | null;
  table: HudHighTable | null;
  decisions: readonly StoredContractDecision[];
  specJson: unknown;
  delivery: DeliveryRecord;
  ship: HudShip;
  commitTimes: ReadonlyMap<string, string>;
}

function event(at: string, kind: string, fields: Partial<HudTimelineEntry> = {}): HudTimelineEntry {
  return { at, kind, stage: null, note: null, ...fields };
}

function tableEvents(table: HudHighTable | null): HudTimelineEntry[] {
  if (!table || table.skipped) return [];
  const events: HudTimelineEntry[] = [];
  const seatedAt = inOrder(table.seats.map((seat) => seat.seated_at))[0];
  if (seatedAt) {
    const standing = table.seats.filter((seat) => seat.origin === 'standing').length;
    events.push(
      event(seatedAt, 'table_seated', { picked: table.seats.length - standing, standing }),
    );
  }
  const landed = table.seats.length > 0 && table.seats.every((seat) => seat.state === 'done');
  const landedAt = landed ? inOrder(table.seats.map((seat) => seat.done_at)).at(-1) : undefined;
  if (landedAt) {
    events.push(
      event(landedAt, 'notes_landed', {
        count: table.seats.length,
        findings: table.seats.reduce((sum, seat) => sum + (seat.findings ?? 0), 0),
      }),
    );
  }
  const chief = table.chief;
  if (chief && isTime(chief.done_at)) {
    events.push(
      event(chief.done_at, 'chief_ruled', {
        duration_ms: spanMs(chief.started_at, chief.done_at),
        verdict: chief.verdict,
      }),
    );
  }
  return events;
}

const DECISION_QUESTION_CHARS = 80;

function shortQuestion(packet: Record<string, unknown>): string | null {
  const text = str(packet.question) ?? str(packet.title);
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DECISION_QUESTION_CHARS
    ? `${flat.slice(0, DECISION_QUESTION_CHARS - 1).trimEnd()}…`
    : flat;
}

// One Record row per decision, naming it: when it was opened (with its question) and when the
// person answered it.
function decisionEvents(decisions: readonly StoredContractDecision[]): HudTimelineEntry[] {
  const events: HudTimelineEntry[] = [];
  for (const { packet, status } of decisions) {
    const raw = packet as unknown as Record<string, unknown>;
    const decision = str(raw.decision_id) ?? str(raw.id);
    const named = decision ? { decision } : {};
    const createdAt = str(raw.created_at);
    if (isTime(createdAt)) {
      const subject = shortQuestion(raw);
      events.push(
        event(createdAt, 'decision_opened', { ...named, ...(subject ? { subject } : {}) }),
      );
    }
    const resolvedAt = str(raw.resolved_at);
    if (status === 'resolved' && isTime(resolvedAt)) {
      events.push(event(resolvedAt, 'decision_answered', named));
    }
  }
  return events;
}

function specEvents(specJson: unknown): HudTimelineEntry[] {
  const spec = asRecord(specJson);
  const at = str(asRecord(spec?.frozen)?.frozen_at);
  if (!spec || !isTime(at)) return [];
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  return [
    event(at, 'spec_frozen', {
      requirements: count(spec.behaviour),
      criteria: count(spec.acceptance_criteria),
    }),
  ];
}

function deliveryEvents(
  delivery: DeliveryRecord,
  ship: HudShip,
  commitTimes: ReadonlyMap<string, string>,
): HudTimelineEntry[] {
  const own = delivery.commit_split?.own_shas ? new Set(delivery.commit_split.own_shas) : null;
  const events = delivery.commits
    .filter((commit) => own === null || own.has(commit.sha))
    .flatMap((commit) => {
      const at = commitTimes.get(commit.sha);
      return at
        ? [event(at, 'commit', { sha: commit.sha.slice(0, 7), subject: commit.subject })]
        : [];
    })
    .slice(-TIMELINE_COMMITS);
  if (ship.push) {
    events.push(event(ship.push.at, 'push', { state: ship.push.state, count: ship.commits }));
  }
  if (ship.pr && typeof ship.pr.number === 'number') {
    events.push(event(ship.pr.first_at ?? ship.pr.at, 'pr_opened', { number: ship.pr.number }));
  }
  const ci = ship.ci;
  if (ci && (ci.state === 'pass' || ci.state === 'fail')) {
    const jobs = ci.jobs ?? [];
    events.push(
      event(inOrder(jobs.map((job) => job.completed_at)).at(-1) ?? ci.at, 'ci', {
        state: ci.state,
        count: ci.total ?? jobs.length,
      }),
    );
  }
  return events;
}

export function buildRecordEvents(sources: RecordEventSources): HudTimelineEntry[] {
  const rulesAt = sources.rulesLoaded?.recorded_at;
  return [
    ...(isTime(rulesAt)
      ? [
          event(rulesAt, 'rules_loaded', {
            count: sources.rulesLoaded?.applicable_rules?.length ?? 0,
          }),
        ]
      : []),
    ...tableEvents(sources.table),
    ...decisionEvents(sources.decisions),
    ...specEvents(sources.specJson),
    ...deliveryEvents(sources.delivery, sources.ship, sources.commitTimes),
  ].filter((entry) => isTime(entry.at));
}

function recordEventsSafe(projectRoot: string, sources: RecordEventSources): HudTimelineEntry[] {
  try {
    return buildRecordEvents(sources);
  } catch (error) {
    logHudWriteError(projectRoot, 'record events', error);
    return [];
  }
}

// One rule orders the Record: event time, with unreadable times last and arrival order as the
// tie-break, so out-of-order arrivals still read in the order they happened.
function mergeTimeline(
  stages: readonly HudTimelineEntry[],
  events: readonly HudTimelineEntry[],
): HudTimelineEntry[] {
  const timeOf = (entry: HudTimelineEntry) => {
    const at = Date.parse(entry.at);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  return [...stages, ...events]
    .map((entry, index) => ({ entry, index, at: timeOf(entry) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1))
    .map(({ entry }) => entry);
}

export interface HudShipCommit {
  sha: string;
  subject: string;
  own: boolean | null;
}

export interface HudShip {
  commits: number;
  commit_list: HudShipCommit[];
  commit_decision: string | null;
  merge_commit: string | null;
  push: DeliveryPush | null;
  pr: DeliveryPr | null;
  pr_state: DeliveryPrState | null;
  pr_title: string | null;
  pr_files: number | null;
  pr_additions: number | null;
  pr_deletions: number | null;
  ci: DeliveryCi | null;
  ci_read_at: string | null;
  all_green: boolean;
  merged: boolean;
  own: CommitGroup | null;
  inherited: CommitGroup | null;
  inherited_count: number;
  files_changed: number | null;
}

export interface HudWorkflow {
  name: string;
  started_at: string | null;
  tokens: number | null;
  usd: number | null;
  unpriced: string[];
}

export interface HudDeliveryPlan {
  commit: boolean;
  push: boolean;
  pr: boolean;
  ci: boolean;
  merge: boolean;
  reason: string | null;
}

export interface DeliveryPlanInput {
  enabled: boolean;
  commitDeclined: boolean;
  ciGate: string;
  hasCi: boolean;
}

export function computeDeliveryPlan(input: DeliveryPlanInput): HudDeliveryPlan {
  const commit = !input.commitDeclined;
  const push = input.enabled && commit;
  const ci = push && input.ciGate !== 'off' && input.hasCi;
  const reason = !commit
    ? 'Edit only · no commit'
    : !push
      ? 'No push for this change'
      : !ci
        ? 'No CI'
        : null;
  return { commit, push, pr: push, ci, merge: push, reason };
}

function repoHasCi(projectRoot: string): boolean {
  try {
    return readdirSync(join(projectRoot, '.github', 'workflows')).some((name) =>
      /\.ya?ml$/.test(name),
    );
  } catch {
    return false;
  }
}

function readPolicy(projectRoot: string): ResolvedDeliveryPolicy | null {
  try {
    return loadDeliveryPolicy(projectRoot).policy;
  } catch (error) {
    logHudWriteError(projectRoot, 'delivery policy', error);
    return null;
  }
}

function buildDeliveryPlan(
  projectRoot: string,
  policy: ResolvedDeliveryPolicy | null,
  delivery: DeliveryRecord | null,
): HudDeliveryPlan | null {
  if (!policy) return null;
  return computeDeliveryPlan({
    enabled: policy.enabled,
    commitDeclined: delivery?.commit_decision?.answer === 'decline',
    ciGate: policy.process.ci.gate,
    hasCi: repoHasCi(projectRoot),
  });
}

export interface HudPlanProgress {
  steps: number;
  done: number;
}

function planFile(path: string): string {
  return toPosixPath(path).replace(/^\.\//, '');
}

function stageHasStarted(stages: readonly HudStage[], stage: string): boolean {
  const found = stages.find((entry) => entry.stage === stage);
  return found !== undefined && found.state !== 'missing';
}

function buildPlanProgress(
  projectRoot: string,
  dirName: string,
  changedFiles: readonly string[] | null,
  buildStarted: boolean,
): HudPlanProgress | null {
  const steps = readFeaturePlan(projectRoot, dirName)?.steps;
  if (!buildStarted) return null;
  if (!Array.isArray(steps) || steps.length === 0 || changedFiles === null) return null;
  const changed = new Set(changedFiles.map(planFile));
  const done = steps.filter(
    (step) =>
      Array.isArray(step?.files) &&
      step.files.some((file) => typeof file === 'string' && changed.has(planFile(file))),
  ).length;
  return { steps: steps.length, done };
}

export interface HudStartPoint {
  source: ChangeStartSource;
  base: string | null;
  files_known: boolean;
}

export interface HudSnapshot {
  schema: typeof HUD_SNAPSHOT_SCHEMA;
  session_id: string;
  generated_at: string;
  scope: { qualified: boolean; reason: HudScopeReason };
  workflow: HudWorkflow | null;
  active: boolean;
  route: string | null;
  lane: string | null;
  lane_stages?: string[];
  lane_reason: string | null;
  headline: HudHeadline;
  change: {
    dir: string;
    id: string | null;
    issue: string | null;
    title: string | null;
    branch: string | null;
    status: string | null;
  } | null;
  paused: Array<{ workflow: string; lane: string | null }>;
  stages: HudStage[];
  timeline: HudTimelineEntry[];
  table: HudHighTable | null;
  claims: HudClaim[];
  gates: HudGate[];
  gates_expected: string[];
  flags: HudFlag[];
  rules: { recorded: boolean; applicable: number | null; loaded_at: string | null };
  findings: HudFindings | null;
  decisions: {
    pending: Array<{ id: string; category: string; question: string }>;
    resolved: number;
  };
  questions: { asked: number; answered: number; auto_answered: number; deferred: number } | null;
  last_block: RuleStopRecord | null;
  delivery_plan: HudDeliveryPlan | null;
  plan: HudPlanProgress | null;
  ship: HudShip | null;
  verdict: HudVerdictRecord | null;
  receipt: { path: string } | null;
  evidence_expected: Array<{
    file: string;
    expectation: 'always' | 'on here' | 'if present' | 'off here';
    present: boolean;
  }>;
  isolation: { status: string; stages: number; tokens_not_recarried: number } | null;
  cost: HudCost | null;
  tech_debt: { raised: TechDebtIndexEntry[] } | null;
  rule_overrides: Array<{ rule: string; file: string; by: string; at: string }> | null;
  record_gaps?: string[];
  repairs?: Array<{ what: string; at: string | null }>;
  rung?: HudRung;
  verdict_stale?: true;
  /** Where this change's files and commits are measured from, and whether that is a fallback. */
  start_point?: HudStartPoint | null;
  proof?: HudStageProof[];
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const TRACK_RECORD_BUNDLES = 50;

export function buildTrackRecords(
  projectRoot: string,
  activeDir: string,
  roles: readonly string[],
): Map<string, HudTrackRecord> {
  const records = new Map<string, HudTrackRecord>();
  if (roles.length === 0) return records;
  try {
    const others = listFeatureDirs(projectRoot)
      .filter((dir) => dir !== activeDir)
      .sort((a, b) =>
        (parseFeatureDirName(b)?.ulid ?? '').localeCompare(parseFeatureDirName(a)?.ulid ?? ''),
      )
      .slice(0, TRACK_RECORD_BUNDLES);
    if (others.length === 0) return records;
    const metrics = aggregateSpecPipelineMetrics(projectRoot, others);
    for (const role of roles) {
      const key = role as keyof typeof metrics.changed_spec_rate;
      const rate = metrics.changed_spec_rate[key];
      if (!rate || rate.fired === 0) continue;
      records.set(role, {
        changes: rate.fired,
        changed_spec: rate.changed,
        empty: metrics.empty_by_role[key]?.empty ?? 0,
        avg_tokens: Math.round((metrics.tokens_by_role[key] ?? 0) / rate.fired),
      });
    }
  } catch (error) {
    logHudWriteError(projectRoot, 'track record', error);
    records.clear();
  }
  return records;
}

function withTrackRecords(
  projectRoot: string,
  dirName: string,
  table: HudHighTable | null,
): HudHighTable | null {
  if (!table || table.seats.length === 0) return table;
  const records = buildTrackRecords(
    projectRoot,
    dirName,
    table.seats.map((seat) => seat.role),
  );
  return {
    ...table,
    seats: table.seats.map((seat) => ({ ...seat, track_record: records.get(seat.role) ?? null })),
  };
}

function buildStages(projectRoot: string, dirName: string, fold: FoldedChange): HudStage[] {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  return fold.stages.map((stage) => {
    const own = rows.filter((row) => row.stage === stage.stage);
    const last = own.at(-1) as (Record<string, unknown> & { agent?: unknown }) | undefined;
    const end = [...own].reverse().find((row) => row.kind === 'stage_end') as
      Record<string, unknown> | undefined;
    const artifacts = end?.artifact_paths;
    return {
      stage: stage.stage,
      state: stage.state,
      mandatory: isLaneStage(fold.lane, stage.stage),
      started_at: stage.started_at,
      ended_at: stage.ended_at,
      duration_ms: stage.duration_ms,
      duration_unreliable: stage.duration_unreliable,
      agent: str(last?.agent),
      proof_file: Array.isArray(artifacts) ? (str(artifacts[0]) ?? null) : null,
    };
  });
}

export interface HudFixProofClaim {
  kind: 'fix-proof';
  proof: FixProofState;
  label: string;
  verdict: 'pass' | 'inconclusive';
  test_id: string | null;
}

export interface HudAcceptanceClaim {
  kind: 'acceptance';
  id: string;
  label: string;
  test_id: string | null;
  /** pass: a checks run after Build started passed; mapped: has a test, not run yet. */
  verdict: 'pass' | 'mapped' | 'missing';
}

export type HudClaim = HudFixProofClaim | HudAcceptanceClaim;

function criterionThens(specJson: unknown): Map<string, string> {
  const criteria = asRecord(specJson)?.acceptance_criteria;
  const thens = new Map<string, string>();
  for (const entry of Array.isArray(criteria) ? criteria : []) {
    const criterion = asRecord(entry);
    const id = str(criterion?.criterion_id);
    const then = str(criterion?.then);
    if (id && then) thens.set(id, then);
  }
  return thens;
}

// A claim passes only on a green checks run recorded after Build started; before that a claim
// with a mapped test reads "has a test, not run yet", never a pass.
function checksPassedSince(projectRoot: string, dirName: string, since: string | null): boolean {
  const startedAt = Date.parse(since ?? '');
  if (Number.isNaN(startedAt)) return false;
  const report = readFeatureChecks(projectRoot, dirName);
  const reportAt = Date.parse(report?.generated_at ?? report?.recorded_at ?? '');
  return report !== null && report.ran && report.passed && reportAt >= startedAt;
}

function buildAcceptanceClaims(
  projectRoot: string,
  dirName: string,
  lane: string | null,
  changedFiles: readonly string[] | null,
  specJson: unknown,
  buildStartedAt: string | null,
): HudAcceptanceClaim[] {
  if (changedFiles === null) return [];
  const checked = checksPassedSince(projectRoot, dirName, buildStartedAt);
  try {
    const result = buildChangeTraceabilityMap({
      projectRoot,
      dirName,
      changedFiles,
      lane: LANES.find((known) => known === lane) ?? 'graduated',
    });
    if (!result) return [];
    const thens = criterionThens(specJson);
    const links = new Map(result.map.forward.map((link) => [link.promise_id, link]));
    return result.automated.map((id) => {
      const testId = links.get(id)?.proving_checks[0] ?? null;
      return {
        kind: 'acceptance',
        id,
        label: thens.get(id) ?? id,
        test_id: testId,
        verdict: testId ? (checked ? 'pass' : 'mapped') : 'missing',
      };
    });
  } catch (error) {
    logHudWriteError(projectRoot, 'claims', error);
    return [];
  }
}

function buildClaims(kind: string | undefined, projectRoot: string, dirName: string): HudClaim[] {
  if (kind !== 'fix') return [];
  const rows = readFixProofRows(projectRoot, dirName);
  const proof = foldFixProofState(rows);
  return [
    {
      kind: 'fix-proof',
      proof,
      label: FIX_PROOF_STATE_LABEL[proof],
      verdict: proof === 'red-green' ? 'pass' : 'inconclusive',
      test_id: rows.at(-1)?.test_id ?? null,
    },
  ];
}

function readGateVerdict(row: Record<string, unknown>): HudGateVerdict {
  const raw = String(row.verdict ?? '').toLowerCase();
  if (raw === 'pass' || raw === 'fail' || raw === 'inconclusive') return raw;
  if (raw === 'skipped') return row.skip_kind === 'did-not-run' ? 'did-not-run' : 'not-required';
  return 'pending';
}

function buildGates(projectRoot: string, dirName: string): HudGate[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of readFeatureEvidence(projectRoot, dirName)) {
    if (row.engine !== 'verification-gate') continue;
    latest.set(row.code, row as unknown as Record<string, unknown>);
  }
  const stageEnds = stageEndTimes(projectRoot, dirName);
  return [...latest.entries()].map(([code, row]) => {
    const verdict: HudGateVerdict = gateIsJudged(code, rowRecordedAt(row), stageEnds)
      ? readGateVerdict(row)
      : 'not-judged';
    const owner = gateCatalogEntry(code)?.owner;
    return {
      name: code,
      required: verdict !== 'not-required',
      strength: gateStrengthFromRun(code, row, verdict),
      verdict,
      ...(owner ? { owner } : {}),
    };
  });
}

function gateStrengthFromRun(
  code: string,
  row: Record<string, unknown>,
  verdict: HudGateVerdict,
): HudGate['strength'] {
  if (verdict === 'did-not-run' || verdict === 'not-required') return null;
  const tier = gateCatalogEntry(code)?.strength;
  if (tier) return tier;
  return row.strength_class === 'deterministic' || row.strength_class === 'llm-judged'
    ? row.strength_class
    : null;
}

export function expectedGateCodes(lane: string | null): string[] {
  return VERIFICATION_GATES.filter((code) => gateExpectedOnLane(code, lane));
}

function ownPr(
  delivery: DeliveryRecord,
  ownShas: ReadonlySet<string> | null,
  inheritedShas: readonly string[],
): DeliveryPr | null {
  const pr = delivery.pr ?? null;
  if (!pr) return null;
  const head = pr.head_sha ?? null;
  if (head === null) return (pr.state ?? null) === null ? pr : null;
  if (ownShas !== null && ownShas.has(head)) return pr;
  const recordedHere =
    delivery.commits.some((commit) => commit.sha === head) && !inheritedShas.includes(head);
  return pr.state === 'merged' && recordedHere ? pr : null;
}

function readingIsCurrent(
  ci: DeliveryCi,
  pr: DeliveryPr | null,
  push: DeliveryPush | null,
): boolean {
  if (pr?.head_sha && ci.sha !== pr.head_sha) return false;
  if (push?.sha && ci.sha !== push.sha && Date.parse(ci.at) < Date.parse(push.at)) return false;
  return true;
}

export function buildShip(delivery: DeliveryRecord, filesChanged: number | null = null): HudShip {
  const split = delivery.commit_split ?? null;
  const ownShas = split?.own_shas ? new Set(split.own_shas) : null;
  const inheritedShas = split?.inherited_shas ?? [];
  const commitList = delivery.commits.map((commit) => ({
    sha: commit.sha.slice(0, 7),
    subject: commit.subject,
    own: ownShas === null ? null : ownShas.has(commit.sha),
  }));
  const pr = ownPr(delivery, ownShas, inheritedShas);
  const prState = pr?.state ?? null;
  const rawCi = delivery.ci ?? null;
  const ci =
    rawCi && rawCi.state === 'pass' && !readingIsCurrent(rawCi, pr, delivery.push ?? null)
      ? { ...rawCi, state: 'pending' as const }
      : rawCi;
  return {
    commits:
      ownShas === null
        ? (split?.own?.count ?? 0)
        : delivery.commits.filter((commit) => ownShas.has(commit.sha)).length,
    commit_list: commitList,
    commit_decision: delivery.commit_decision?.answer ?? null,
    merge_commit: delivery.merge_commit,
    push: delivery.push ?? null,
    pr,
    pr_state: prState,
    pr_title: pr?.title ?? null,
    pr_files: pr?.changed_files ?? null,
    pr_additions: pr?.additions ?? null,
    pr_deletions: pr?.deletions ?? null,
    ci,
    ci_read_at: rawCi?.at ?? null,
    all_green: ci?.state === 'pass' && prState === 'open',
    merged: prState === 'merged',
    own: split?.own ?? null,
    inherited: split?.inherited ?? null,
    inherited_count: inheritedShas.length,
    files_changed: filesChanged,
  };
}

function buildWorkflow(
  projectRoot: string,
  sessionId: string,
  state: WorkflowState,
): HudWorkflow | null {
  const name = state.active?.workflow ?? null;
  if (name === null || name === 'feature-development' || name === 'no-workflow') return null;
  const startedAt =
    episodeStart(readRouteTurns(projectRoot, sessionId), name as RoutedWorkflow) ??
    state.turn_started_at ??
    null;
  const cost =
    startedAt === null
      ? { tokens: null, usd: null, unpriced: [] }
      : workflowCostSince(projectRoot, sessionId, startedAt);
  return { name, started_at: startedAt, ...cost };
}

function buildQuestions(projectRoot: string, dirName: string): HudSnapshot['questions'] {
  const clarification = asRecord(
    readJsonFile(join(projectRoot, featureFilePath(dirName, 'clarification'))),
  );
  const counts = asRecord(asRecord(clarification?.questions)?.counts);
  if (!counts) return null;
  return {
    asked: num(counts.asked) ?? 0,
    answered: num(counts.answered) ?? 0,
    auto_answered: num(counts.auto_answered) ?? 0,
    deferred: num(counts.deferred) ?? 0,
  };
}

function changeDecisions(projectRoot: string, dirName: string | null): StoredContractDecision[] {
  if (dirName === null) return [];
  const changeKey = featureChangeKey(dirName);
  // A packet with no change tag belongs to no change, exactly like an untagged verdict.
  return readContractDecisions(projectRoot).filter(
    ({ packet }) => (packet as unknown as Record<string, unknown>).change === changeKey,
  );
}

function buildDecisions(rows: readonly StoredContractDecision[]): HudSnapshot['decisions'] {
  const pending: HudSnapshot['decisions']['pending'] = [];
  let resolved = 0;
  for (const { packet, status } of rows) {
    if (status === 'resolved') {
      resolved += 1;
      continue;
    }
    const rich = readAnyDecisionPacket(packet);
    const raw = packet as unknown as Record<string, unknown>;
    pending.push({
      id: rich?.decision_id ?? str(raw.id) ?? str(raw.decision_id) ?? 'unknown',
      category: rich?.category ?? str(raw.category) ?? 'unknown',
      question: rich?.question ?? str(raw.title) ?? str(raw.question) ?? '',
    });
  }
  return { pending, resolved };
}

function buildEvidenceExpected(
  projectRoot: string,
  sessionId: string,
  dirName: string,
): HudSnapshot['evidence_expected'] {
  const config = buildBundleCompletenessConfig(projectRoot, sessionId, dirName);
  return BUNDLE_MANIFEST.map((entry) => ({
    file: entry.file,
    expectation:
      entry.required === 'always'
        ? ('always' as const)
        : entry.required === 'optional'
          ? ('if present' as const)
          : isBundleFileRequired(entry, config)
            ? ('on here' as const)
            : ('off here' as const),
    present: existsSync(join(projectRoot, featureDir(dirName), entry.file)),
  }));
}

function findingsScan<T>(row: Record<string, unknown> | undefined): HudFindingsScan<T> {
  if (!row) {
    return {
      status: 'did not run',
      total: null,
      counts: null,
      blocking: false,
      from_cache: false,
      items: null,
      overflow: 0,
      recorded_at: null,
    };
  }
  const counts = asRecord(row.counts) as Record<string, number> | null;
  const total = (num(counts?.deterministic) ?? 0) + (num(counts?.heuristic) ?? 0);
  return {
    status: total > 0 ? 'open' : 'clean',
    total,
    counts,
    blocking: row.blocking === true,
    from_cache: row.from_cache === true,
    items: Array.isArray(row.findings) ? (row.findings as T[]) : null,
    overflow: num(row.findings_overflow) ?? 0,
    recorded_at: rowRecordedAt(row),
  };
}

function buildFindings(projectRoot: string, dirName: string): HudFindings | null {
  const ruleRow = readRuleRun(projectRoot, dirName)
    .filter((row) => row.kind === 'findings')
    .at(-1) as Record<string, unknown> | undefined;
  const dupRow = readDuplication(projectRoot, dirName).at(-1) as
    Record<string, unknown> | undefined;
  if (!ruleRow && !dupRow) return null;
  return {
    rules: findingsScan<RuleRunFinding>(ruleRow),
    near_copies: findingsScan<DuplicationRowFinding>(dupRow),
  };
}

function readVerdictRecord(projectRoot: string, sessionId: string): HudVerdictRecord | null {
  const record = asRecord(readJsonFile(hudVerdictPath(projectRoot, sessionId)));
  return record?.schema === 'paqad.hud-verdict/1' ? (record as unknown as HudVerdictRecord) : null;
}

const UNJUDGED_CHANGE_GAP = 'paqad could not record which change this verdict judged';

const VERDICT_KINDS: ReadonlySet<unknown> = new Set(['pass', 'fail', 'inconclusive']);

function couldNotProve(verdict: HudVerdictRecord, gap: string | null): HudVerdictRecord {
  const gaps = Array.isArray(verdict.record_gaps) ? verdict.record_gaps : [];
  return {
    ...verdict,
    kind: 'inconclusive',
    passed: false,
    word: PAQAD_VERDICT.inconclusive,
    reasons: Array.isArray(verdict.reasons) ? verdict.reasons : [],
    ...(gap ? { record_gaps: [...gaps, gap] } : {}),
  };
}

interface VerdictReading {
  verdict: HudVerdictRecord | null;
  stale: boolean;
}

function freshVerdict(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  open: boolean,
): VerdictReading {
  const none: VerdictReading = { verdict: null, stale: false };
  const verdict = readVerdictRecord(projectRoot, sessionId);
  if (!verdict) return none;
  const unjudged = verdict.change === null || verdict.change === undefined;
  if (!unjudged && verdict.change !== dirName) return none;
  const writtenAt = Date.parse(verdict.written_at);
  if (Number.isNaN(writtenAt)) return none;
  const editedAt = latestEditAt(projectRoot, dirName);
  if (editedAt !== null && writtenAt < editedAt) return { verdict: null, stale: true };
  // While the change is open, a verdict taken before it moved on (a later stage start, end or
  // deferral) judged an earlier state; a closed change keeps its verdict.
  const movedAt = open ? latestStageMoveAt(projectRoot, dirName) : null;
  if (movedAt !== null && writtenAt < movedAt) return { verdict: null, stale: true };
  if (unjudged) return { verdict: couldNotProve(verdict, UNJUDGED_CHANGE_GAP), stale: false };
  return {
    verdict: VERDICT_KINDS.has(verdict.kind) ? verdict : couldNotProve(verdict, null),
    stale: false,
  };
}

function ladderChecks(
  projectRoot: string,
  dirName: string,
  verdict: HudVerdictRecord | null,
): LadderChecks {
  const report = readFeatureChecks(projectRoot, dirName);
  const reportAt = Date.parse(report?.generated_at ?? report?.recorded_at ?? '');
  const verdictAt = Date.parse(verdict?.written_at ?? '');
  if (report && Number.isFinite(reportAt) && Number.isFinite(verdictAt) && reportAt > verdictAt) {
    return report.ran && report.passed ? 'green' : 'red';
  }
  const row = readFeatureEvidence(projectRoot, dirName)
    .filter((entry) => entry.engine === 'verification-gate' && entry.code === 'code-tests-lint')
    .at(-1) as Record<string, unknown> | undefined;
  const gate = row ? readGateVerdict(row) : null;
  if (gate === 'pass') return 'green';
  if (gate === 'fail') return 'red';
  return 'unknown';
}

export function workKindOf(verdict: HudVerdictRecord | null): HudVerdictRecord['kind'] | null {
  if (!verdict) return null;
  return verdict.work_kind ?? verdict.kind;
}

function lowerFirst(text: string): string {
  return text.length > 0 ? `${text[0]!.toLowerCase()}${text.slice(1)}` : text;
}

function unprovenLines(gates: readonly HudGate[], verdict: HudVerdictRecord | null): string[] {
  const named = new Set(
    (verdict?.work_reasons ?? []).map((reason) => reason.slice(0, reason.indexOf(':'))),
  );
  return gates
    .filter(
      (gate) =>
        gate.verdict === 'inconclusive' && gate.owner !== 'paqad-record' && !named.has(gate.name),
    )
    .map(
      (gate) =>
        `paqad could not prove ${lowerFirst(gateCatalogEntry(gate.name)?.label ?? gate.name)}`,
    );
}

function verdictFromEarlierTurn(
  verdict: HudVerdictRecord | null,
  workflow: WorkflowState,
  turnRunning: boolean,
): boolean {
  if (!verdict || !turnRunning) return false;
  const turnAt = Date.parse(workflow.turn_started_at ?? '');
  const writtenAt = Date.parse(verdict.written_at);
  return Number.isFinite(turnAt) && Number.isFinite(writtenAt) && writtenAt < turnAt;
}

function recordGaps(verdict: HudVerdictRecord | null, laneRecorded: boolean): string[] {
  const gaps = new Set(Array.isArray(verdict?.record_gaps) ? verdict.record_gaps : []);
  if (!laneRecorded) gaps.add(LANE_RECORD_GAP.text);
  return [...gaps];
}

function buildRepairs(
  projectRoot: string,
  dirName: string,
): Array<{ what: string; at: string | null }> {
  return readFeatureStageUnit(projectRoot, dirName)
    .filter((row) => row.kind === RECORD_REPAIR_KIND && typeof row.reason === 'string')
    .map((row) => ({ what: String(row.reason), at: rowRecordedAt(row) }));
}

const STAGE_WORDS: Record<string, string> = {
  ticket_intake: 'Intake',
  planning: 'Plan',
  specification: 'Spec',
  development: 'Build',
  review: 'Review',
  checks: 'Checks',
  documentation_sync: 'Docs',
  delivery: 'Deliver',
};

function stageWord(stage: string): string {
  return STAGE_WORDS[stage] ?? stage;
}

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
  'behavioral-correctness': 'The behaviour does not match the spec',
  'requirement-completeness': 'A requirement is incomplete',
  'story-quality': 'A story is not well formed',
  'site-map-freshness': 'The site map no longer matches the app',
};

export function failurePhrase(code: string): string {
  return FAILURE_PHRASES[code] ?? `${code} failed`;
}

export interface HudHeadline {
  text: string;
  tone: HudTone;
  row?: number;
  word?: string;
  rung?: HudRung;
  note?: string;
  gap?: string;
  clock_from?: string;
}

export interface HudHeadlineInput {
  route: string | null;
  active: boolean;
  stages: HudStage[];
  pendingDecisions: number;
  verdict: HudVerdictRecord | null;
  flags: HudFlag[];
  paused: number;
  ladder?: DoneLadder | null;
  checks?: LadderChecks;
  decisions?: ReadonlyArray<{ category: string }>;
  table?: HudHighTable | null;
  ship?: HudShip | null;
  gates?: readonly HudGate[];
  gatesExpected?: readonly string[];
  plan?: HudPlanProgress | null;
  recordGaps?: readonly string[];
  unproven?: readonly string[];
  verdictEarlier?: boolean;
}

export const RUNG_WORDS: Readonly<Record<HudRung, string>> = {
  done: 'Done',
  committed: 'Committed',
  'pr-open': 'PR open',
  'safe-to-merge': 'Safe to merge',
  merged: 'Merged',
};

const BUILD_ENDED_STATES: ReadonlySet<string> = new Set(['complete', 'redone']);

const LANE_STAGE_ENDED_STATES: ReadonlySet<string> = new Set([
  'complete',
  'redone',
  'inconclusive',
  'failed',
]);

export function computeHudFlags(input: {
  stages: HudStage[];
  gates: HudGate[];
  rulesRecorded: boolean;
  tableSkipped: boolean;
  tableLate?: boolean;
  isolationStatus: string;
  isolatedStages: number;
  findings?: HudFindings | null;
  commitSplit?: CommitSplit | null;
}): HudFlag[] {
  const flags: HudFlag[] = [];
  // Rules are due by the end of Build: a running Build, or a Build end paqad only inferred from
  // the files, does not show the rules were skipped.
  const buildEnded = input.stages.some(
    (stage) =>
      stage.stage === 'development' &&
      BUILD_ENDED_STATES.has(stage.state) &&
      stage.started_at !== null,
  );
  if (buildEnded && !input.rulesRecorded) {
    flags.push({ id: 'rules-not-loaded', text: 'The rules for this change were never loaded.' });
  }
  if (input.tableSkipped) {
    flags.push({
      id: 'high-table-skipped',
      text: 'The spec was written by hand, so the High Table never sat.',
    });
  }
  if (input.tableLate) {
    flags.push({
      id: 'high-table-late',
      text: 'The High Table met after the spec was frozen, so it shaped no spec line.',
    });
  }
  // A stage-agent record lands when the agent stops, so isolation is only missing once a lane
  // stage has ended without one, never while the first stage agent still runs.
  const laneStageEnded = input.stages.some(
    (stage) => stage.mandatory && LANE_STAGE_ENDED_STATES.has(stage.state),
  );
  if (input.isolationStatus === 'expected' && input.isolatedStages === 0 && laneStageEnded) {
    flags.push({ id: 'isolation-missing', text: 'No stage ran in its own agent on this lane.' });
  }
  if (input.isolationStatus === 'unresolved') {
    flags.push({
      id: 'lane-unresolved',
      text: 'The lane was never set, so isolation is unproven.',
    });
  }
  const ruleFindings = input.findings?.rules.blocking ? (input.findings.rules.total ?? 0) : 0;
  if (ruleFindings > 0) {
    flags.push({
      id: 'rule-findings',
      text:
        ruleFindings === 1 ? '1 rule finding is open.' : `${ruleFindings} rule findings are open.`,
    });
  }
  const nearCopies = input.findings?.near_copies.total ?? 0;
  if (nearCopies > 0) {
    flags.push({
      id: 'near-copies',
      text:
        nearCopies === 1
          ? '1 near-copy of existing code is open.'
          : `${nearCopies} near-copies of existing code are open.`,
    });
  }
  return flags;
}

const CONFLICT_CATEGORY = 'spec.expert_conflict';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function prName(ship: HudShip | null): string {
  const number = ship?.pr?.number;
  return typeof number === 'number' ? `PR #${number}` : 'The PR';
}

function tableRuled(table: HudHighTable | null | undefined): boolean {
  return table?.chief?.state === 'done' && table.chief.verdict !== null;
}

function runningWords(input: HudHeadlineInput, stage: string): string {
  switch (stage) {
    case 'ticket_intake':
      return 'Reading the ticket';
    case 'planning':
      return 'Planning the change';
    case 'specification': {
      const table = input.table;
      if (table?.seats.some((seat) => seat.state === 'writing')) {
        return 'The High Table is writing its notes';
      }
      if (table?.chief?.state === 'writing') return 'The chief architect is ruling';
      return 'Writing the spec';
    }
    case 'development':
      return input.plan ? `${input.plan.done} of ${input.plan.steps} plan steps built` : 'Building';
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

function workFailure(input: HudHeadlineInput): string {
  const expected = input.gatesExpected ?? [];
  const rank = (name: string) => {
    const index = expected.indexOf(name);
    return index === -1 ? expected.length : index;
  };
  const [first, ...rest] = (input.gates ?? [])
    .filter((gate) => gate.required && gate.verdict === 'fail' && gate.owner !== 'paqad-record')
    .map((gate) => gate.name)
    .sort((a, b) => rank(a) - rank(b));
  if (!first) return 'Needs your attention';
  return rest.length > 0 ? `${failurePhrase(first)} and ${rest.length} more` : failurePhrase(first);
}

function gapLine(gaps: readonly string[]): Pick<HudHeadline, 'gap'> {
  const [first] = gaps;
  if (!first) return {};
  return { gap: gaps.length > 1 ? `${first} and ${gaps.length - 1} more` : first };
}

function headlineRow(
  row: number,
  tone: HudTone,
  text: string,
  word: string,
  extra: Partial<HudHeadline> = {},
): HudHeadline {
  return { text, tone, row, word, ...extra };
}

function settledHeadline(stages: readonly HudStage[]): HudHeadline {
  const next = stages.find((stage) => stage.mandatory && stage.state === 'missing');
  const done = [...stages]
    .reverse()
    .find((stage) => stage.state === 'complete' || stage.state === 'redone');
  if (done && next) {
    return headlineRow(
      18,
      'neutral',
      `${stageWord(done.stage)} done. Next: ${stageWord(next.stage)}`,
      'Working',
    );
  }
  if (!done) {
    return headlineRow(19, 'neutral', `Next: ${next ? stageWord(next.stage) : 'Plan'}`, 'Working');
  }
  return headlineRow(20, 'neutral', 'Every stage is recorded. Waiting for the verdict.', 'Working');
}

function idleHeadline(input: HudHeadlineInput): HudHeadline {
  if (input.paused > 0) {
    return { text: 'A change is paused. Say "continue" to pick it up.', tone: 'neutral' };
  }
  if (input.route && input.route !== 'no-workflow') {
    return { text: `Working on ${input.route.replace(/-/g, ' ')}.`, tone: 'working' };
  }
  return { text: 'Ready. No change in progress.', tone: 'neutral' };
}

function rungHeadline(
  input: HudHeadlineInput,
  ladder: DoneLadder,
  gap: Pick<HudHeadline, 'gap'>,
): HudHeadline | null {
  const pr = prName(input.ship ?? null);
  const rung = ladder.rung;
  if (rung === 'pr-open') {
    const text = ladder.ci === 'unknown' ? `${pr} is open. CI result unknown` : `${pr} is open`;
    return headlineRow(17, 'good', text, RUNG_WORDS[rung], { rung, ...gap });
  }
  if (rung !== 'done' && rung !== 'committed') return null;
  const declined = input.ship?.commit_decision === 'decline';
  const note =
    rung === 'done' && ladder.uncommitted
      ? declined
        ? 'left uncommitted, as you asked'
        : 'not committed'
      : null;
  return headlineRow(16, 'good', RUNG_WORDS[rung], RUNG_WORDS[rung], {
    rung,
    ...(note ? { note } : {}),
    ...gap,
  });
}

export function computeHudHeadline(input: HudHeadlineInput): HudHeadline {
  if (input.pendingDecisions > 0) {
    const conflicts = (input.decisions ?? []).filter(
      (decision) => decision.category === CONFLICT_CATEGORY,
    ).length;
    if (conflicts > 0 && tableRuled(input.table)) {
      return headlineRow(
        5,
        'needs-you',
        `The chief architect has ${plural(conflicts, 'question', 'questions')} for you`,
        'Needs you',
      );
    }
    const n = input.pendingDecisions;
    return headlineRow(
      6,
      'needs-you',
      n === 1 ? '1 decision is waiting for you' : `${n} decisions are waiting for you`,
      'Needs you',
    );
  }
  if (!input.active) return idleHeadline(input);
  const ship = input.ship ?? null;
  const ladder = input.ladder ?? null;
  const pr = prName(ship);
  const gap = gapLine([...(input.recordGaps ?? []), ...(input.unproven ?? [])]);
  if (ladder?.rung === 'merged') {
    return headlineRow(7, 'good', `${pr} is merged`, 'Merged', { rung: 'merged', ...gap });
  }
  if (ladder?.rung === 'safe-to-merge') {
    return headlineRow(8, 'good', `Safe to merge: ${pr} is ready for your merge`, 'Safe to merge', {
      rung: 'safe-to-merge',
      ...gap,
    });
  }
  if (ship?.pr_state === 'closed') return headlineRow(9, 'warn', `${pr} was closed`, 'PR closed');
  if (ship?.pr_state === 'open' && ship.ci?.state === 'fail') {
    return headlineRow(10, 'bad', `CI failed on ${pr}`, 'CI failed', {
      ...(ladder?.rung ? { rung: ladder.rung } : {}),
    });
  }
  if (ship?.push?.state === 'failed')
    return headlineRow(11, 'bad', 'The push failed', 'Push failed');
  const running = input.stages.find((stage) => stage.state === 'running');
  const verdict = input.verdictEarlier && running ? null : input.verdict;
  const work = workKindOf(verdict);
  if (work === 'fail') {
    return headlineRow(12, 'bad', workFailure(input), 'Needs your attention', gap);
  }
  if (work === 'pass' && input.checks === 'red') {
    return headlineRow(12, 'bad', failurePhrase('code-tests-lint'), 'Needs your attention', gap);
  }
  if (verdict && work === 'inconclusive') {
    const reason = (verdict.work_reasons ?? verdict.reasons ?? [])[0];
    return headlineRow(
      13,
      'warn',
      reason ? `Inconclusive: ${reason}` : 'Inconclusive',
      'Inconclusive',
      gap,
    );
  }
  if (ship?.pr_state === 'open' && ship.ci?.state === 'pending') {
    const delivery = input.stages.find((stage) => stage.stage === 'delivery');
    return headlineRow(14, 'working', `Watching CI on ${pr}`, 'Working', {
      ...(delivery?.started_at ? { clock_from: delivery.started_at } : {}),
    });
  }
  if (running) {
    return headlineRow(15, 'working', runningWords(input, running.stage), 'Working', {
      ...(running.started_at ? { clock_from: running.started_at } : {}),
    });
  }
  const rung = verdict && ladder ? rungHeadline(input, ladder, gap) : null;
  if (rung) return rung;
  if (work === 'pass') {
    return headlineRow(
      13,
      'warn',
      'Inconclusive: no checks result for this change',
      'Inconclusive',
      gap,
    );
  }
  return settledHeadline(input.stages);
}

export interface BuildHudSnapshotOptions {
  now?: () => Date;
  turnRunning?: boolean;
}

export const TURN_END_SOURCES: ReadonlySet<string> = new Set([
  'hook:verification-completion',
  'hook:capability-gate-completion',
]);

export function buildHudSnapshot(
  projectRoot: string,
  sessionHint: string | null,
  options: BuildHudSnapshotOptions = {},
): HudSnapshot {
  const now = options.now ?? (() => new Date());
  const sessionId =
    sessionHint?.trim() || readLedgerSessionId(projectRoot) || resolveSessionId(projectRoot, null);
  const workflow = readWorkflowState(projectRoot, sessionId);
  const route = workflow.active?.workflow ?? null;
  const paused = workflow.paused.map((entry) => ({
    workflow: entry.workflow,
    lane: entry.lane ?? null,
  }));
  const scope = qualifyHudChange(projectRoot, sessionId, now);
  const dirName = scope.dir;
  const decisionRows = changeDecisions(projectRoot, dirName);
  const decisions = buildDecisions(decisionRows);
  const lastBlock = readRuleStopRecord(projectRoot, sessionId);

  if (!dirName) {
    return {
      schema: HUD_SNAPSHOT_SCHEMA,
      session_id: sessionId,
      generated_at: now().toISOString(),
      scope: { qualified: false, reason: scope.reason },
      workflow: buildWorkflow(projectRoot, sessionId, workflow),
      active: false,
      route,
      lane: workflow.active?.lane ?? null,
      lane_reason: workflow.active?.reason ?? null,
      headline: computeHudHeadline({
        route,
        active: false,
        stages: [],
        pendingDecisions: decisions.pending.length,
        verdict: null,
        flags: [],
        paused: paused.length,
        decisions: decisions.pending,
      }),
      change: null,
      paused,
      stages: [],
      timeline: [],
      table: null,
      claims: [],
      gates: [],
      gates_expected: expectedGateCodes(workflow.active?.lane ?? null),
      flags: [],
      rules: { recorded: false, applicable: null, loaded_at: null },
      findings: null,
      decisions,
      questions: null,
      last_block: lastBlock,
      delivery_plan: buildDeliveryPlan(projectRoot, readPolicy(projectRoot), null),
      plan: null,
      ship: null,
      verdict: null,
      receipt: null,
      evidence_expected: [],
      isolation: null,
      cost: null,
      tech_debt: null,
      rule_overrides: null,
    };
  }

  const reading = freshVerdict(projectRoot, sessionId, dirName, scope.reason === 'qualified');
  const verdict = reading.verdict;
  const receiptPath = hudReceiptPath(projectRoot, sessionId);
  const receipt = verdict && existsSync(receiptPath) ? { path: receiptPath } : null;
  const record = readFeatureRecord(projectRoot, dirName);
  const fold = foldFeature(projectRoot, sessionId, dirName);
  const stages = buildStages(projectRoot, dirName, fold);
  const gates = buildGates(projectRoot, dirName);
  const specJson = readJsonFile(join(projectRoot, featureFilePath(dirName, 'specification')));
  const lane = fold.lane ?? record?.lane ?? workflow.active?.lane ?? null;
  const table = withTrackRecords(
    projectRoot,
    dirName,
    buildHighTableView(projectRoot, dirName, specJson, lane),
  );
  const rulesLoaded = readRulesLoaded(projectRoot, dirName);
  const delivery = readFeatureDelivery(projectRoot, dirName);
  const policy = readPolicy(projectRoot);
  const startPoint = readChangeStartPoint(projectRoot, dirName, policy?.process.pr.base ?? null);
  const changeGit = readChangeGit(
    projectRoot,
    policy?.process.pr.base ?? null,
    (error) => logHudWriteError(projectRoot, 'changed files', error),
    startPoint,
  );
  const changedFiles = changeGit?.files ?? null;
  const ship = buildShip(delivery, changedFiles ? changedFiles.length : null);
  const isolationStatus = stageIsolationStatus(projectRoot, sessionId, dirName);
  const isolationSummary = summarizeStageIsolation(projectRoot, dirName);
  const findings = buildFindings(projectRoot, dirName);
  const checks = ladderChecks(projectRoot, dirName, verdict);
  const ladder = computeDoneLadder({
    workKind: workKindOf(verdict),
    checks,
    uncommitted: readWorkingTreeDirty(projectRoot),
    commits: Math.max(ship.commits, changeGit?.commitTimes.size ?? 0),
    prState: ship.pr_state,
    ci: ship.ci?.state ?? null,
  });
  const buildStage = stages.find((entry) => entry.stage === 'development');
  const plan = buildPlanProgress(
    projectRoot,
    dirName,
    changedFiles,
    stageHasStarted(stages, 'development'),
  );
  const gatesExpected = expectedGateCodes(lane);
  const gaps = recordGaps(verdict, (fold.lane ?? record?.lane ?? null) !== null);
  const questions = buildQuestions(projectRoot, dirName);
  const proof = buildStageProof({
    ...readStageProofEvidence(projectRoot, dirName),
    lane,
    stages,
    gates,
    judged: verdict !== null,
    planProgress: plan,
    questions,
    rules: rulesLoaded ? rulesLoaded.applicable_rules.length : null,
    changedFiles,
  });
  const flags = computeHudFlags({
    stages,
    gates,
    rulesRecorded: rulesLoaded !== null,
    tableSkipped: table?.skipped ?? false,
    tableLate: table?.met_after_freeze ?? false,
    isolationStatus,
    isolatedStages: isolationSummary?.stages ?? 0,
    findings,
    commitSplit: delivery.commit_split ?? null,
  });

  return {
    schema: HUD_SNAPSHOT_SCHEMA,
    session_id: sessionId,
    generated_at: now().toISOString(),
    scope: { qualified: true, reason: scope.reason },
    workflow: null,
    active: true,
    route,
    lane,
    lane_stages: laneStages(fold.lane),
    lane_reason: workflow.active?.reason ?? null,
    headline: computeHudHeadline({
      route,
      active: true,
      stages,
      pendingDecisions: decisions.pending.length,
      verdict,
      flags,
      paused: paused.length,
      ladder,
      checks,
      decisions: decisions.pending,
      table,
      ship,
      gates,
      gatesExpected,
      plan,
      // While a stage still runs nothing has truly gone unrecorded yet: no gap line.
      recordGaps: stages.some((stage) => stage.state === 'running') ? [] : gaps,
      unproven: unprovenLines(gates, verdict),
      verdictEarlier: verdictFromEarlierTurn(verdict, workflow, options.turnRunning === true),
    }),
    change: {
      dir: dirName,
      id: record?.change ?? null,
      issue: record?.issue ?? null,
      title: record?.title ?? null,
      branch: record?.branch ?? null,
      status: record?.status ?? null,
    },
    paused,
    stages,
    timeline: mergeTimeline(
      buildTimeline(projectRoot, dirName, {
        title: record?.title ?? null,
        issue: record?.issue ?? null,
        lane,
      }),
      recordEventsSafe(projectRoot, {
        rulesLoaded,
        table,
        decisions: decisionRows,
        specJson,
        delivery,
        ship,
        commitTimes: changeGit?.commitTimes ?? new Map(),
      }),
    ),
    table,
    claims: [
      ...buildClaims(record?.kind, projectRoot, dirName),
      ...buildAcceptanceClaims(
        projectRoot,
        dirName,
        lane,
        changedFiles,
        specJson,
        buildStage?.started_at ?? null,
      ),
    ],
    gates,
    gates_expected: gatesExpected,
    flags,
    rules: {
      recorded: rulesLoaded !== null,
      applicable: rulesLoaded ? rulesLoaded.applicable_rules.length : null,
      loaded_at: rulesLoaded?.recorded_at ?? null,
    },
    findings,
    decisions,
    questions,
    last_block: lastBlock,
    delivery_plan: buildDeliveryPlan(projectRoot, policy, delivery),
    plan,
    ship,
    verdict,
    receipt,
    evidence_expected: buildEvidenceExpected(projectRoot, sessionId, dirName),
    isolation: {
      status: isolationStatus,
      stages: isolationSummary?.stages ?? 0,
      tokens_not_recarried: isolationSummary?.tokensNotRecarried ?? 0,
    },
    cost: buildHudCost(projectRoot, dirName, {
      turnRunning: options.turnRunning === true,
      now,
      onError: (error) => logHudWriteError(projectRoot, 'cost', error),
    }),
    tech_debt: { raised: readFeatureTechDebtIndex(projectRoot, dirName) ?? [] },
    rule_overrides: readRuleOverrides(projectRoot, dirName).map(({ rule, file, by, at }) => ({
      rule,
      file,
      by,
      at,
    })),
    ...optionalList('record_gaps', gaps),
    ...optionalList('repairs', buildRepairs(projectRoot, dirName)),
    ...(ladder.rung ? { rung: ladder.rung } : {}),
    ...(reading.stale ? { verdict_stale: true as const } : {}),
    start_point: startPoint
      ? {
          source: startPoint.source,
          base: startPoint.base,
          files_known: startPoint.worktree !== null,
        }
      : null,
    proof,
  };
}

function optionalList<K extends string, T>(key: K, list: T[]): Partial<Record<K, T[]>> {
  return list.length > 0 ? ({ [key]: list } as Record<K, T[]>) : {};
}

export function writeHudSnapshot(
  projectRoot: string,
  sessionHint: string | null,
  options: BuildHudSnapshotOptions = {},
): { path: string; snapshot: HudSnapshot } {
  const snapshot = buildHudSnapshot(projectRoot, sessionHint, options);
  const path = hudSnapshotPath(projectRoot, snapshot.session_id);
  writeFileAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { path, snapshot };
}

export function writeHudSnapshotSafe(
  projectRoot: string,
  sessionHint: string | null,
  source: string,
): string | null {
  try {
    return writeHudSnapshot(projectRoot, sessionHint, {
      turnRunning: !TURN_END_SOURCES.has(source),
    }).path;
  } catch (error) {
    logHudWriteError(projectRoot, source, error);
    return null;
  }
}

function logHudWriteError(projectRoot: string, source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  appendHooksLog(projectRoot, `hud-snapshot (${source}): not written: ${message}`);
  try {
    const logs = join(projectRoot, '.paqad', 'logs');
    mkdirSync(logs, { recursive: true });
    appendFileSync(
      join(logs, 'hook-failures.log'),
      `[${new Date().toISOString()}] ERROR hud-snapshot (${source}): ${message}\n`,
    );
  } catch {}
}

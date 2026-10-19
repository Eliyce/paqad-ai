// The paqad HUD snapshot (issue #639, Part 7).
//
// One file per session, `.paqad/session/hud/<session>.json` (schema `paqad.hud/2`), that the
// Claude Code mod reads instead of asking the model or starting a process. It is built only
// from records paqad already keeps: the routed workflow, the change's feature bundle, the
// decision folders, the evidence rows and the in-session receipt. A field whose source is not
// ready yet (claims, rule-stop details, cost) is `null` or empty, never guessed. The headline and
// the flags are computed here, in one tested place.
//
// Writes are best-effort by contract: `writeHudSnapshotSafe` never throws, so a hook or verb
// that refreshes the snapshot can never have its decision or exit code changed by it.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readContractDecisions } from '@/decisions/authoring.js';
import { readAnyDecisionPacket } from '@/decisions/packet-shape.js';
import { GATE_STRENGTH_TIER } from '@/evidence/grading.js';
import {
  readDuplication,
  readFeatureEvidence,
  readRuleRun,
  type DuplicationRowFinding,
  type RuleRunFinding,
} from '@/feature-evidence/bundle-ledgers.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { BUNDLE_MANIFEST, isBundleFileRequired } from '@/feature-evidence/manifest.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { readRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import {
  currentFeature,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { isMandatoryStage } from '@/stage-evidence/stages.js';
import type { FoldedChange } from '@/stage-evidence/types.js';
import { summarizeStageIsolation } from '@/stage-isolation/isolation-summary.js';
import {
  buildBundleCompletenessConfig,
  stageIsolationStatus,
} from '@/verification/repository/bundle-completeness-config.js';
import type { VerificationGate } from '@/core/types/verification.js';

import { hudReceiptPath, hudSnapshotPath, hudVerdictPath, writeFileAtomic } from './files.js';
import { buildHighTableView, type HudHighTable } from './high-table-view.js';
import type { HudVerdictRecord } from './receipt-file.js';

export const HUD_SNAPSHOT_SCHEMA = 'paqad.hud/2';

export type HudTone = 'neutral' | 'working' | 'needs-you' | 'good' | 'warn' | 'bad';

export interface HudStage {
  stage: string;
  state: string;
  mandatory: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  /**
   * True when the fold found the stage's start and end implausible (near-zero or inverted). The
   * receipt reads such a stage as marked, never done, so the band must too (#639 AC-45).
   */
  duration_unreliable: boolean;
  /** Who recorded the stage's last row: `orchestrator`, `paqad-<stage>`, or a hook writer. */
  agent: string | null;
  /** The artifact the stage ended against, when it named one. */
  proof_file: string | null;
}

/**
 * A gate's verdict on the HUD. Issue #639, Part 10 — `did-not-run` is a skipped gate that was owed
 * a check that did not happen; `not-required` is a skipped gate the change gave nothing to check
 * (and any skipped row written before Part 10). Neither is a pass.
 */
export type HudGateVerdict =
  'pass' | 'fail' | 'inconclusive' | 'not-required' | 'did-not-run' | 'pending';

export interface HudGate {
  name: string;
  required: boolean;
  strength: 'deterministic' | 'llm-judged' | null;
  verdict: HudGateVerdict;
}

export interface HudFlag {
  id: string;
  text: string;
}

export type { HudChief, HudHighTable, HudSeat } from './high-table-view.js';

/**
 * What one scan found on this change. A scan with no row reads `did not run`, never `clean`:
 * a clean result needs a row whose counts say zero (Gate 3).
 */
export type HudFindingsStatus = 'open' | 'clean' | 'did not run';

export interface HudFindingsScan<T> {
  status: HudFindingsStatus;
  /** Deterministic plus heuristic findings from the row's counts; `null` when it did not run. */
  total: number | null;
  counts: Record<string, number> | null;
  blocking: boolean;
  /** True when the row came from a cached run. */
  from_cache: boolean;
  /** The findings the row kept, or `null` when the row kept none (an older row). */
  items: T[] | null;
  /** Findings past the row's cap, counted but not kept. */
  overflow: number;
  recorded_at: string | null;
}

export interface HudFindings {
  rules: HudFindingsScan<RuleRunFinding>;
  near_copies: HudFindingsScan<DuplicationRowFinding>;
}

export interface HudSnapshot {
  schema: typeof HUD_SNAPSHOT_SCHEMA;
  session_id: string;
  generated_at: string;
  /** True when a feature-development change is in progress in this session. */
  active: boolean;
  route: string | null;
  lane: string | null;
  lane_reason: string | null;
  headline: { text: string; tone: HudTone };
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
  /**
   * The live High Table (issue #639, Part 13): seats with state, times, budgets and tokens, the
   * chief's verdict and rulings, gaps, questions and who shaped each spec line. Null on the fast
   * lane and when no High Table was seated.
   */
  table: HudHighTable | null;
  /** Fix-protocol claims arrive with Part 15. */
  claims: [];
  gates: HudGate[];
  flags: HudFlag[];
  rules: { recorded: boolean; applicable: number | null; loaded_at: string | null };
  /**
   * Issue #639 (Part 12) — the rule findings and near-copies the change's latest bundle rows
   * keep. `null` when neither scan left a row for this change.
   */
  findings: HudFindings | null;
  decisions: {
    pending: Array<{ id: string; category: string; question: string }>;
    resolved: number;
  };
  questions: { asked: number; answered: number; auto_answered: number; deferred: number } | null;
  /** The last rule stop arrives with Part 18. */
  last_block: null;
  ship: {
    commits: number;
    commit_decision: string | null;
    merge_commit: string | null;
    /** Push, PR, CI and the own-vs-inherited split arrive with Part 16. */
    push: null;
    pr: null;
    ci: null;
  } | null;
  verdict: HudVerdictRecord | null;
  receipt: { path: string } | null;
  evidence_expected: Array<{
    file: string;
    expectation: 'always' | 'on here' | 'if present' | 'off here';
    present: boolean;
  }>;
  isolation: { status: string; stages: number; tokens_not_recarried: number } | null;
  /** The change's cost arrives with Part 23. */
  cost: null;
}

// ── small tolerant readers ────────────────────────────────────────────────────

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

// ── field builders ────────────────────────────────────────────────────────────

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
      mandatory: isMandatoryStage(stage.stage),
      started_at: stage.started_at,
      ended_at: stage.ended_at,
      duration_ms: stage.duration_ms,
      duration_unreliable: stage.duration_unreliable,
      agent: str(last?.agent),
      proof_file: Array.isArray(artifacts) ? (str(artifacts[0]) ?? null) : null,
    };
  });
}

function buildGates(projectRoot: string, dirName: string): HudGate[] {
  // The latest row per gate wins: a gate re-run later in the change supersedes its first verdict.
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of readFeatureEvidence(projectRoot, dirName)) {
    if (row.engine !== 'verification-gate') continue;
    latest.set(row.code, row as unknown as Record<string, unknown>);
  }
  return [...latest.entries()].map(([code, row]) => {
    const raw = String(row.verdict ?? '').toLowerCase();
    const verdict: HudGateVerdict =
      raw === 'pass' || raw === 'fail' || raw === 'inconclusive'
        ? raw
        : raw === 'skipped'
          ? row.skip_kind === 'did-not-run'
            ? 'did-not-run'
            : 'not-required'
          : 'pending';
    const tier = GATE_STRENGTH_TIER[code as VerificationGate];
    const strength =
      tier ??
      (row.strength_class === 'deterministic' || row.strength_class === 'llm-judged'
        ? row.strength_class
        : null);
    return { name: code, required: verdict !== 'not-required', strength, verdict };
  });
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

function buildDecisions(projectRoot: string): HudSnapshot['decisions'] {
  const pending: HudSnapshot['decisions']['pending'] = [];
  let resolved = 0;
  for (const { packet, status } of readContractDecisions(projectRoot)) {
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

/** A scan summary built from its latest row, or `did not run` when there is none. */
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
  // The latest findings row wins; a drift row from the reconciler is not a rule scan.
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

// ── headline and flags: the one place they are decided ────────────────────────

const STAGE_WORDS: Record<string, string> = {
  ticket_intake: 'Intake',
  planning: 'Planning',
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

export interface HudHeadlineInput {
  route: string | null;
  active: boolean;
  stages: HudStage[];
  pendingDecisions: number;
  verdict: HudVerdictRecord | null;
  flags: HudFlag[];
  paused: number;
}

/**
 * The flags: something weak that a reader should see even at Safe to merge. Each one comes
 * from a recorded fact, never an opinion.
 */
export function computeHudFlags(input: {
  stages: HudStage[];
  gates: HudGate[];
  rulesRecorded: boolean;
  tableSkipped: boolean;
  /** Issue #639 (Part 13): a High Table that met after the spec was frozen. */
  tableLate?: boolean;
  isolationStatus: string;
  isolatedStages: number;
  /** Issue #639 (Part 12) — an open finding raises a flag; the band shows only its count. */
  findings?: HudFindings | null;
}): HudFlag[] {
  const flags: HudFlag[] = [];
  const touchedCode = input.stages.some(
    (stage) => stage.stage === 'development' && stage.state !== 'missing',
  );
  if (touchedCode && !input.rulesRecorded) {
    flags.push({ id: 'rules-not-loaded', text: 'The rules for this change were never loaded.' });
  }
  for (const gate of input.gates) {
    if (gate.verdict === 'inconclusive') {
      flags.push({ id: `gate:${gate.name}`, text: `${gate.name} could not reach a result.` });
    }
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
  if (input.isolationStatus === 'expected' && input.isolatedStages === 0) {
    flags.push({ id: 'isolation-missing', text: 'No stage ran in its own agent on this lane.' });
  }
  if (input.isolationStatus === 'unresolved') {
    flags.push({
      id: 'lane-unresolved',
      text: 'The lane was never set, so isolation is unproven.',
    });
  }
  const ruleFindings = input.findings?.rules.total ?? 0;
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

/**
 * The one headline sentence: what just changed and what is next. Its tone drives the band's
 * colour: any open flag turns a Safe to merge amber (decision Q19).
 */
export function computeHudHeadline(input: HudHeadlineInput): { text: string; tone: HudTone } {
  if (input.pendingDecisions > 0) {
    const n = input.pendingDecisions;
    return { text: `Needs you: ${n} decision${n === 1 ? '' : 's'} waiting.`, tone: 'needs-you' };
  }
  if (!input.active) {
    if (input.paused > 0) {
      return { text: 'A change is paused. Say "continue" to pick it up.', tone: 'neutral' };
    }
    if (input.route && input.route !== 'no-workflow') {
      return { text: `Working on ${input.route.replace(/-/g, ' ')}.`, tone: 'working' };
    }
    return { text: 'Ready. No change in progress.', tone: 'neutral' };
  }
  const running = input.stages.find((stage) => stage.state === 'running');
  if (running) {
    const next = input.stages.find(
      (stage) =>
        stage.mandatory &&
        stage.state === 'missing' &&
        input.stages.indexOf(stage) > input.stages.indexOf(running),
    );
    return {
      text: `${stageWord(running.stage)} in progress.${next ? ` Next: ${stageWord(next.stage)}.` : ''}`,
      tone: 'working',
    };
  }
  if (input.verdict) {
    const flagged = input.flags.length;
    const tone: HudTone =
      input.verdict.kind === 'fail'
        ? 'bad'
        : input.verdict.kind === 'inconclusive' || flagged > 0
          ? 'warn'
          : 'good';
    const suffix = flagged > 0 ? ` ${flagged} flag${flagged === 1 ? '' : 's'} open.` : '';
    return { text: `${input.verdict.word}.${suffix}`, tone };
  }
  const next = input.stages.find((stage) => stage.mandatory && stage.state === 'missing');
  const done = [...input.stages].reverse().find((stage) => stage.state === 'complete');
  if (next) {
    return {
      text: `${done ? `${stageWord(done.stage)} done. ` : ''}Next: ${stageWord(next.stage)}.`,
      tone: 'working',
    };
  }
  return { text: 'Every stage is recorded. Waiting for the verdict.', tone: 'working' };
}

// ── build and write ───────────────────────────────────────────────────────────

export interface BuildHudSnapshotOptions {
  now?: () => Date;
}

/** Build the snapshot for `sessionHint` from disk. Pure reads; throws only on a programming error. */
export function buildHudSnapshot(
  projectRoot: string,
  sessionHint: string | null,
  options: BuildHudSnapshotOptions = {},
): HudSnapshot {
  const now = options.now ?? (() => new Date());
  const sessionId = resolveSessionId(projectRoot, sessionHint);
  const workflow = readWorkflowState(projectRoot, sessionId);
  const route = workflow.active?.workflow ?? null;
  const paused = workflow.paused.map((entry) => ({
    workflow: entry.workflow,
    lane: entry.lane ?? null,
  }));
  const dirName = currentFeature(projectRoot, sessionId);
  const verdict = readVerdictRecord(projectRoot, sessionId);
  const decisions = buildDecisions(projectRoot);
  const receiptPath = hudReceiptPath(projectRoot, sessionId);
  const receipt = existsSync(receiptPath) ? { path: receiptPath } : null;

  if (!dirName) {
    return {
      schema: HUD_SNAPSHOT_SCHEMA,
      session_id: sessionId,
      generated_at: now().toISOString(),
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
      }),
      change: null,
      paused,
      stages: [],
      table: null,
      claims: [],
      gates: [],
      flags: [],
      rules: { recorded: false, applicable: null, loaded_at: null },
      findings: null,
      decisions,
      questions: null,
      last_block: null,
      ship: null,
      verdict,
      receipt,
      evidence_expected: [],
      isolation: null,
      cost: null,
    };
  }

  const record = readFeatureRecord(projectRoot, dirName);
  const fold = foldFeature(projectRoot, sessionId, dirName);
  const stages = buildStages(projectRoot, dirName, fold);
  const gates = buildGates(projectRoot, dirName);
  const specJson = readJsonFile(join(projectRoot, featureFilePath(dirName, 'specification')));
  const lane = fold.lane ?? record?.lane ?? workflow.active?.lane ?? null;
  const table = buildHighTableView(projectRoot, dirName, specJson, lane);
  const rulesLoaded = readRulesLoaded(projectRoot, dirName);
  const delivery = readFeatureDelivery(projectRoot, dirName);
  const isolationStatus = stageIsolationStatus(projectRoot, sessionId, dirName);
  const isolationSummary = summarizeStageIsolation(projectRoot, dirName);
  const findings = buildFindings(projectRoot, dirName);
  const flags = computeHudFlags({
    stages,
    gates,
    rulesRecorded: rulesLoaded !== null,
    tableSkipped: table?.skipped ?? false,
    tableLate: table?.met_after_freeze ?? false,
    isolationStatus,
    isolatedStages: isolationSummary?.stages ?? 0,
    findings,
  });

  return {
    schema: HUD_SNAPSHOT_SCHEMA,
    session_id: sessionId,
    generated_at: now().toISOString(),
    active: true,
    route,
    lane,
    lane_reason: workflow.active?.reason ?? null,
    headline: computeHudHeadline({
      route,
      active: true,
      stages,
      pendingDecisions: decisions.pending.length,
      verdict,
      flags,
      paused: paused.length,
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
    table,
    claims: [],
    gates,
    flags,
    rules: {
      recorded: rulesLoaded !== null,
      applicable: rulesLoaded ? rulesLoaded.applicable_rules.length : null,
      loaded_at: rulesLoaded?.recorded_at ?? null,
    },
    findings,
    decisions,
    questions: buildQuestions(projectRoot, dirName),
    last_block: null,
    ship: {
      commits: delivery.commits.length,
      commit_decision: delivery.commit_decision?.answer ?? null,
      merge_commit: delivery.merge_commit,
      push: null,
      pr: null,
      ci: null,
    },
    verdict,
    receipt,
    evidence_expected: buildEvidenceExpected(projectRoot, sessionId, dirName),
    isolation: {
      status: isolationStatus,
      stages: isolationSummary?.stages ?? 0,
      tokens_not_recarried: isolationSummary?.tokensNotRecarried ?? 0,
    },
    cost: null,
  };
}

/** Build and atomically write the snapshot. Throws on failure; prefer {@link writeHudSnapshotSafe}. */
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

/**
 * Refresh the snapshot, never throwing: a failure is appended to `.paqad/logs/hook-failures.log`
 * (the hooks' shared failure log) and `null` is returned. This is the form every hook and verb
 * calls, so a HUD write can never change what they decide.
 */
export function writeHudSnapshotSafe(
  projectRoot: string,
  sessionHint: string | null,
  source: string,
): string | null {
  try {
    return writeHudSnapshot(projectRoot, sessionHint).path;
  } catch (error) {
    try {
      const logs = join(projectRoot, '.paqad', 'logs');
      mkdirSync(logs, { recursive: true });
      const message = error instanceof Error ? error.message : String(error);
      appendFileSync(
        join(logs, 'hook-failures.log'),
        `[${new Date().toISOString()}] ERROR hud-snapshot (${source}): ${message}\n`,
      );
    } catch {
      // The caller's path outranks the log line: a read-only tree must not turn into a throw.
    }
    return null;
  }
}

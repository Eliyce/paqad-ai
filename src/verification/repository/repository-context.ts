// Issue #117 (C-1 + C-2 + C-4) — build a VerificationContext from repository
// reality, for the agent-independent hook/backstop run path. Unlike the
// in-session provider context (which trusts the host agent to populate the
// judgment signals), this builder computes them from on-disk artifacts: the git
// diff, the traceability map, the decision store, the spec-review report, and
// the quality baseline. The result carries a non-`provider-workflow` origin so
// the run is distinguishable from the skippable in-workflow path.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { readChecksReportForFeature } from '@/checks/report-target.js';
import type { Lane } from '@/core/types/routing.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import {
  currentFeature,
  readFeatureStageUnit,
  recordedLaneOrFull,
} from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { buildAndWriteChangeTraceabilityMap, readTraceabilityMap } from '@/traceability/index.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { SpecReviewDefect, SpecReviewReport } from '@/compliance/types.js';
import { runQualityRatchetGate } from '@/quality-ratchet/index.js';
import { runBackstopMutation, type BackstopMutationDeps } from '@/mutation/backstop.js';
import {
  detectStaleDocTargets,
  isCodeFile,
  isDocumentationFile,
  isPaqadArtifactPath,
  isTestFile,
  loadChangeEvidence,
} from '@/pipeline/change-evidence.js';
import { subtractUnchangedBaselineFiles } from '@/pipeline/dirty-baseline.js';
import type { VerificationContext, VerificationOrigin } from '@/core/types/verification.js';
import { engineLog } from '@/core/logger-registry.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';

import {
  computeAcTestMapping,
  computeImplementationReview,
  computeSpecReview,
} from './judgment-inputs.js';

/** Project-relative areas a change may always touch without counting as drift:
 *  tests, docs, and the framework's own work-product directories. The spec
 *  boundary is unioned with these so legitimate test/doc updates are never
 *  reported as out-of-scope. */
const ALWAYS_IN_SCOPE_PREFIXES = ['tests', 'docs', '.paqad', '.changeset'];

export interface BuildRepositoryVerificationContextOptions {
  projectRoot: string;
  /** The agent-independent origin firing this run (issue #117). */
  origin: Extract<VerificationOrigin, 'hook-completion' | 'git-backstop' | 'ci-backstop'>;
  /**
   * Issue #293 — injectable effects for the mutation step (mode, profile, test command, runner),
   * so a test never spawns a real tool. Production callers leave it unset.
   */
  mutationDeps?: BackstopMutationDeps;
}

export interface RepositoryVerificationContextResult {
  context: VerificationContext;
  /**
   * Human-readable notes for signals that could not be proven either way and
   * escalate rather than block (e.g. "spec review: no frozen spec on record").
   * The trust verdict (issue #117 C-6) surfaces these so an inconclusive signal
   * is never *silently* passed.
   */
  escalations: string[];
}

/**
 * Build the verification context for a hook/backstop run. Loads every artifact
 * defensively — a missing or malformed artifact degrades to "nothing to prove"
 * for that signal rather than throwing, so a clean change in a freshly
 * onboarded project passes while a real contract violation blocks.
 */
export async function buildRepositoryVerificationContext(
  options: BuildRepositoryVerificationContextOptions,
): Promise<RepositoryVerificationContextResult> {
  const { projectRoot, origin } = options;

  // Resolve the active change's bundle ONCE (issue #528): the same `dirName` keys both the
  // recorded-lane fold and the re-homed check report read below. Fails safe to no active
  // feature (null) — never a throw — so a non-feature-development run degrades cleanly.
  const sessionId = resolveActiveSessionId(projectRoot);
  const dirName = resolveActiveFeatureDir(projectRoot, sessionId);

  const changeEvidence = await loadChangeEvidence(projectRoot);
  // Issue #576 (Finding 1b) — at the in-session completion origin, subtract files that were
  // ALREADY dirty when the session started and are byte-for-byte unchanged since. Without this a
  // pre-existing modified tracked file (a JetBrains-written config, a stale edit from before the
  // session) is swept in by the whole-tree `git status` and blamed on a read-only turn. Scoped to
  // `hook-completion`: commit / push / CI origins stay path-based and never consult the baseline.
  const sessionScopedFiles =
    origin === 'hook-completion'
      ? subtractUnchangedBaselineFiles(projectRoot, sessionId, changeEvidence.files)
      : changeEvidence.files;
  // Issue #205 — strip every `.paqad/` home (root or a self-hosted nested
  // `runtime/base/.paqad/`) from the verification changed-file scan. Generated
  // framework artifacts are never a unit of implementation, so they must not
  // reach codeChanged, the test-evidence preview, the quality ratchet, or scope
  // drift, where they would falsely demand test evidence and doc updates.
  const changedFiles = sessionScopedFiles.filter((filePath) => !isPaqadArtifactPath(filePath));
  const codeChanged = changedFiles.some((filePath) => isCodeFile(filePath));
  const staleDocTargets = await detectStaleDocTargets(projectRoot, changedFiles);

  // Issue #324 — consume the recorded lane instead of a hardcoded `'full'`. The fast
  // lane collects only strictness (the ratchet skips the heavy complexity/dead-code
  // measures), so a small change is no longer forced through the full measurement set.
  // A null/unreadable lane fails safe to `full`. Read before the change map, which records it.
  const recordedLane = readRecordedLane(projectRoot, sessionId, dirName);

  // Real test/build/format evidence (issue #318): the deterministic check runner
  // (`paqad-ai checks run`) persists a structured report the agent produces
  // mid-turn. When present, the backstop consumes it so its verdict PROVES the
  // checks ran instead of assuming they passed. When absent, test-evidence stays
  // unproven here (Inconclusive), never a silent pass or a false block.
  const checksReport = readChecksReportForFeature(projectRoot, dirName);
  const structuredTestResults =
    checksReport && checksReport.results.length > 0 ? checksReport.results : undefined;

  // Issue #639, Part 11 — build the change-scoped acceptance-criteria map here, so the gate
  // reads a real map even when `checks run` never ran, and write it best-effort. The map on
  // disk is read first: it is what the other map readers used before this map existed.
  const diskMap = await readTraceabilityMapSafely(projectRoot);
  const changeMap = await buildAndWriteChangeTraceabilityMap(
    {
      projectRoot,
      dirName,
      // The branch's changed files, not the session-scoped subset: a proving test committed
      // earlier on the branch still proves its criterion.
      changedFiles: changeEvidence.files.filter((filePath) => !isPaqadArtifactPath(filePath)),
      testResults: structuredTestResults,
      lane: recordedLane,
    },
    // Logged to .paqad/logs/hooks.log, never stderr: on the Stop path a stderr line is shown to
    // the user and would change what the hook printed (AC-69).
    (message) => appendHooksLog(projectRoot, `verification: ${message}`),
  );
  const traceabilityMap = effectiveTraceabilityMap(changeMap.result?.map ?? null, diskMap);
  const pendingDecisions = readPendingDecisions(projectRoot);
  const specReview = await loadSpecReviewSafely(projectRoot);

  const acMapping = computeAcTestMapping({
    // A failed build cannot tell whether the spec is frozen; it reads did not run, never
    // not required.
    specFrozen: changeMap.result !== null || changeMap.error !== null,
    map: changeMap.result?.map ?? null,
    visual: changeMap.result?.visual,
    manual: changeMap.result?.manual,
    buildError: changeMap.error,
  });
  const implementationReview = computeImplementationReview(
    pendingDecisions,
    await lastSourceEditAt(projectRoot, dirName, changedFiles),
  );
  const specReviewSignal = computeSpecReview({
    specReview,
    // A built change map means the active change's spec is frozen (it is read from
    // specification.json), including a spec whose criteria are all visual or manual.
    hasFrozenSpec: changeMap.result !== null || hasFrozenSpec(traceabilityMap),
    codeChanged,
  });

  const specBoundary = deriveSpecBoundary(traceabilityMap);

  const escalations: string[] = [];
  if (specReviewSignal.inconclusive) {
    escalations.push(`spec-review: ${specReviewSignal.detail}`);
  }
  if (codeChanged && !structuredTestResults) {
    escalations.push(
      'test-evidence: no check report on record (`paqad-ai checks run` was not run this ' +
        'change) — test-evidence strength is Inconclusive here; run the checks or rely on CI.',
    );
  }

  const qualityRatchetResult = await runQualityRatchetGate({
    projectRoot,
    changedFiles,
    lane: recordedLane,
    stackProfile: null,
    deadCodeFiles: readDeadCodeFiles(traceabilityMap),
    decisionStore: new DecisionStore(projectRoot),
  });

  // Issue #293 — mutation testing, opt-in through the floored `mutation_mode` (default off). It
  // runs only on the ci-backstop and git-backstop origins, after the project's own test command
  // passes; the hook-completion origin never runs it, so the end of an agent turn stays fast.
  // With the mode off nothing runs and only the not-required note is planted.
  const mutation = await runBackstopMutation({
    projectRoot,
    origin,
    changedFiles,
    lane: recordedLane,
    deps: options.mutationDeps,
  });

  const context: VerificationContext = {
    project_root: projectRoot,
    verification_origin: origin,
    verification_stage: 'backstop-completion',
    modules: [],
    changed_files: changedFiles,
    changed_files_source: changeEvidence.source,
    spec_boundary: specBoundary,
    code_changed: codeChanged,
    test_files_changed: changedFiles.some((filePath) => isTestFile(filePath)),
    documentation_files_changed: changedFiles.some((filePath) => isDocumentationFile(filePath)),
    stale_doc_targets: staleDocTargets,
    structured_test_results: structuredTestResults,
    // Computed judgment signals (issue #117 C-2).
    ac_test_mapping_passed: acMapping.passed,
    ac_test_mapping_detail: acMapping.detail,
    ac_test_mapping_outcome: acMapping.outcome,
    spec_review_passed: specReviewSignal.passed,
    implementation_review_passed: implementationReview.passed,
    implementation_review_findings: implementationReview.findings,
    waiting_decisions: implementationReview.waiting,
    // Signals the backstop does not judge: these are provider-workflow concerns
    // (story/spec authoring quality, architecture taste, behaviour, DB review)
    // that need model judgment. Their standalone gates are omitted from the
    // backstop runner (they report `skipped`), so leaving these true here only
    // keeps the change-completeness roll-up from blocking on what it cannot see.
    requirements_complete: true,
    story_quality_passed: true,
    architecture_compliant: true,
    // Derived from the persisted check report (issue #318), no longer a hardcoded
    // `true`. Absent report ⇒ the neutral in-session default; the backstop verdict
    // itself is driven by `structured_test_results` via the appended check gate, so
    // an absent report reads as Inconclusive there rather than a vacuous pass.
    code_tests_lint_passed: checksReport ? checksReport.passed : true,
    behavioral_correctness_passed: true,
    database_quality_passed: true,
    quality_ratchet_result: qualityRatchetResult,
    ...mutation,
    lane: recordedLane,
    expected_ui_modules: [],
    expected_api_modules: [],
    expected_integration_modules: [],
    expected_error_catalog_modules: [],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
  };

  return { context, escalations };
}

/**
 * Resolve the session id the completion run is under (the hook runs with `CLAUDE_SESSION_ID`),
 * falling back to the shared per-machine ledger session. Never throws.
 */
function resolveActiveSessionId(projectRoot: string): string {
  return resolveSessionId(projectRoot, process.env.CLAUDE_SESSION_ID ?? null);
}

/**
 * The active change's feature bundle dir, or null when none is open. Best-effort — any fault
 * reads as "no active feature" so a non-feature-development run degrades cleanly (issue #528).
 */
function resolveActiveFeatureDir(projectRoot: string, sessionId: string): string | null {
  try {
    return currentFeature(projectRoot, sessionId);
  } catch {
    return null;
  }
}

/**
 * The lane recorded on the current change's open ledger row (issue #324). Reads the open
 * change's folded lane from the already-resolved session + bundle dir (issue #528). Fails safe
 * to `full` when no change is open, the lane is unset, or anything throws — never a silent
 * relaxation.
 */
function readRecordedLane(projectRoot: string, sessionId: string, dirName: string | null): Lane {
  return recordedLaneOrFull(projectRoot, sessionId, dirName);
}

async function readTraceabilityMapSafely(projectRoot: string): Promise<TraceabilityMap | null> {
  try {
    return await readTraceabilityMap(projectRoot);
  } catch (error) {
    engineLog('warn', `paqad: could not read traceability map (${describeError(error)})`);
    return null;
  }
}

/**
 * The map the spec-review, scope-drift and dead-code readers use (issue #639, Part 11). The
 * freshly built change map when there is one. Otherwise the map on disk, unless that is a
 * change map an earlier change left behind: it does not describe this change, so it is
 * ignored and those readers stay on "no map", where they were before change maps existed.
 */
function effectiveTraceabilityMap(
  changeMap: TraceabilityMap | null,
  diskMap: TraceabilityMap | null,
): TraceabilityMap | null {
  if (changeMap) return changeMap;
  if (diskMap?.scope === 'change') return null;
  return diskMap;
}

function latestDevelopmentRowAt(projectRoot: string, dirName: string | null): number {
  if (dirName === null) return NaN;
  let latest = NaN;
  try {
    for (const row of readFeatureStageUnit(projectRoot, dirName)) {
      if (row.stage !== 'development') continue;
      const at = Date.parse(rowRecordedAt(row) ?? '');
      if (!Number.isNaN(at) && (Number.isNaN(latest) || at > latest)) latest = at;
    }
  } catch (error) {
    engineLog('warn', `paqad: could not read development rows (${describeError(error)})`);
  }
  return latest;
}

async function latestFileEditAt(projectRoot: string, files: readonly string[]): Promise<number> {
  const times = await Promise.all(
    files.map((file) =>
      stat(join(projectRoot, file)).then(
        (info) => info.mtimeMs,
        () => NaN,
      ),
    ),
  );
  const known = times.filter((at) => !Number.isNaN(at));
  return known.reduce((latest, at) => (Number.isNaN(latest) || at > latest ? at : latest), NaN);
}

export async function lastSourceEditAt(
  projectRoot: string,
  dirName: string | null,
  changedFiles: readonly string[],
): Promise<string | null> {
  const developmentAt = latestDevelopmentRowAt(projectRoot, dirName);
  if (!Number.isNaN(developmentAt)) return new Date(developmentAt).toISOString();
  const fileAt = await latestFileEditAt(projectRoot, changedFiles);
  return Number.isNaN(fileAt) ? null : new Date(fileAt).toISOString();
}

function readPendingDecisions(projectRoot: string): DecisionPacket[] {
  const store = new DecisionStore(projectRoot);
  const packets: DecisionPacket[] = [];
  try {
    for (const decisionId of store.listPendingDecisionIds()) {
      const result = store.readPendingResult(decisionId);
      if (result.packet) {
        packets.push(result.packet);
      }
    }
  } catch (error) {
    engineLog('warn', `paqad: could not read pending decisions (${describeError(error)})`);
  }
  return packets;
}

/**
 * Discover every spec-review report on disk (`.paqad/compliance/<slug>/
 * spec-review.json`, one per frozen spec file) and merge their defects into a
 * single report so the backstop sees the whole project's open spec-review
 * defects without needing to know which spec file is active. Returns null when
 * no report exists.
 */
async function loadSpecReviewSafely(projectRoot: string): Promise<SpecReviewReport | null> {
  try {
    const reportPaths = await fg('.paqad/compliance/*/spec-review.json', {
      cwd: projectRoot,
      absolute: true,
      onlyFiles: true,
    });
    if (reportPaths.length === 0) {
      return null;
    }

    const defects: SpecReviewDefect[] = [];
    const patternAdvisories: SpecReviewReport['pattern_advisories'] = [];
    let metadata: SpecReviewReport['metadata'] | null = null;
    for (const reportPath of reportPaths) {
      const parsed = JSON.parse(await readFile(reportPath, 'utf8')) as Partial<SpecReviewReport>;
      if (Array.isArray(parsed.defects)) {
        defects.push(...parsed.defects);
      }
      if (Array.isArray(parsed.pattern_advisories)) {
        patternAdvisories.push(...parsed.pattern_advisories);
      }
      metadata ??= parsed.metadata ?? null;
    }

    if (metadata === null) {
      return null;
    }
    return { metadata, defects, pattern_advisories: patternAdvisories };
  } catch (error) {
    engineLog('warn', `paqad: could not read spec-review reports (${describeError(error)})`);
    return null;
  }
}

/** A frozen spec is presumed present when the traceability map carries
 *  acceptance-criterion promises — those only exist once a spec was frozen. */
function hasFrozenSpec(map: TraceabilityMap | null): boolean {
  return map !== null && map.forward.some((link) => link.source === 'acceptance-criterion');
}

/** Read the dead/orphan file set the traceability map already computed (#110),
 *  so the quality-ratchet dead-code measure reuses one solver. */
function readDeadCodeFiles(map: TraceabilityMap | null): string[] | null {
  if (map === null || !map.anchors_known) {
    return null;
  }
  return map.backward.filter((link) => link.role === 'orphan').map((link) => link.file);
}

/**
 * Derive the spec boundary (issue #117 C-4) from the traceability map: the
 * directories the frozen spec's promises deliver into, unioned with the
 * always-in-scope test/doc/framework areas. Returns undefined when no
 * frozen-spec-backed map exists, leaving scope-drift inert rather than guessing
 * — the backstop never invents a boundary it cannot ground.
 */
function deriveSpecBoundary(map: TraceabilityMap | null): string[] | undefined {
  if (!hasFrozenSpec(map) || map === null || !map.anchors_known) {
    return undefined;
  }

  const deliveringDirs = new Set<string>();
  for (const link of map.forward) {
    for (const file of link.delivering_code) {
      const dir = dirOf(file);
      if (dir.length > 0) {
        deliveringDirs.add(dir);
      }
    }
  }

  if (deliveringDirs.size === 0) {
    return undefined;
  }

  return [...new Set([...deliveringDirs, ...ALWAYS_IN_SCOPE_PREFIXES])].sort();
}

function dirOf(filePath: string): string {
  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim();
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

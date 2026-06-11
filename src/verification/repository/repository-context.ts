// Issue #117 (C-1 + C-2 + C-4) — build a VerificationContext from repository
// reality, for the agent-independent hook/backstop run path. Unlike the
// in-session provider context (which trusts the host agent to populate the
// judgment signals), this builder computes them from on-disk artifacts: the git
// diff, the traceability map, the decision store, the spec-review report, and
// the quality baseline. The result carries a non-`provider-workflow` origin so
// the run is distinguishable from the skippable in-workflow path.

import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';

import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { readTraceabilityMap } from '@/traceability/index.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { SpecReviewDefect, SpecReviewReport } from '@/compliance/types.js';
import { runQualityRatchetGate } from '@/quality-ratchet/index.js';
import {
  detectStaleDocTargets,
  isCodeFile,
  isDocumentationFile,
  isTestFile,
  loadChangeEvidence,
} from '@/pipeline/change-evidence.js';
import type { VerificationContext, VerificationOrigin } from '@/core/types/verification.js';
import { engineLog } from '@/core/logger-registry.js';

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

  const changeEvidence = await loadChangeEvidence(projectRoot);
  const changedFiles = changeEvidence.files;
  const codeChanged = changedFiles.some((filePath) => isCodeFile(filePath));
  const staleDocTargets = await detectStaleDocTargets(projectRoot, changedFiles);

  const traceabilityMap = await readTraceabilityMapSafely(projectRoot);
  const pendingDecisions = readPendingDecisions(projectRoot);
  const specReview = await loadSpecReviewSafely(projectRoot);

  const acMapping = computeAcTestMapping(traceabilityMap);
  const implementationReview = computeImplementationReview(pendingDecisions);
  const specReviewSignal = computeSpecReview({
    specReview,
    hasFrozenSpec: hasFrozenSpec(traceabilityMap),
    codeChanged,
  });

  const specBoundary = deriveSpecBoundary(traceabilityMap);

  const escalations: string[] = [];
  if (specReviewSignal.inconclusive) {
    escalations.push(`spec-review: ${specReviewSignal.detail}`);
  }

  const qualityRatchetResult = await runQualityRatchetGate({
    projectRoot,
    changedFiles,
    lane: 'full',
    stackProfile: null,
    deadCodeFiles: readDeadCodeFiles(traceabilityMap),
    decisionStore: new DecisionStore(projectRoot),
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
    // Computed judgment signals (issue #117 C-2).
    ac_test_mapping_passed: acMapping.passed,
    ac_test_mapping_detail: acMapping.detail,
    spec_review_passed: specReviewSignal.passed,
    implementation_review_passed: implementationReview.passed,
    implementation_review_findings: implementationReview.findings,
    // Signals the backstop does not judge: these are provider-workflow concerns
    // (story/spec authoring quality, architecture taste, behaviour, DB review)
    // that need model judgment. Their standalone gates are omitted from the
    // backstop runner (they report `skipped`), so leaving these true here only
    // keeps the change-completeness roll-up from blocking on what it cannot see.
    requirements_complete: true,
    story_quality_passed: true,
    architecture_compliant: true,
    code_tests_lint_passed: true,
    behavioral_correctness_passed: true,
    database_quality_passed: true,
    quality_ratchet_result: qualityRatchetResult,
    lane: 'full',
    expected_ui_modules: [],
    expected_api_modules: [],
    expected_integration_modules: [],
    expected_error_catalog_modules: [],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
  };

  return { context, escalations };
}

async function readTraceabilityMapSafely(projectRoot: string): Promise<TraceabilityMap | null> {
  try {
    return await readTraceabilityMap(projectRoot);
  } catch (error) {
    engineLog('warn', `paqad: could not read traceability map (${describeError(error)})`);
    return null;
  }
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

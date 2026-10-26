import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { readChecksReportForFeature } from '@/checks/report-target.js';
import type { Lane } from '@/core/types/routing.js';
import { readChangeStartPoint } from '@/feature-evidence/delivery.js';
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

const ALWAYS_IN_SCOPE_PREFIXES = ['tests', 'docs', '.paqad', '.changeset'];

export interface BuildRepositoryVerificationContextOptions {
  projectRoot: string;
  origin: Extract<VerificationOrigin, 'hook-completion' | 'git-backstop' | 'ci-backstop'>;
  mutationDeps?: BackstopMutationDeps;
}

export interface RepositoryVerificationContextResult {
  context: VerificationContext;
  escalations: string[];
}

export async function buildRepositoryVerificationContext(
  options: BuildRepositoryVerificationContextOptions,
): Promise<RepositoryVerificationContextResult> {
  const { projectRoot, origin } = options;

  const sessionId = resolveActiveSessionId(projectRoot);
  const dirName = resolveActiveFeatureDir(projectRoot, sessionId);

  const changeEvidence = await loadChangeEvidence(projectRoot, {
    since: dirName ? readChangeStartPointSafe(projectRoot, dirName) : null,
  });
  const sessionScopedFiles =
    origin === 'hook-completion'
      ? subtractUnchangedBaselineFiles(projectRoot, sessionId, changeEvidence.files)
      : changeEvidence.files;
  const changedFiles = sessionScopedFiles.filter((filePath) => !isPaqadArtifactPath(filePath));
  const codeChanged = changedFiles.some((filePath) => isCodeFile(filePath));
  const staleDocTargets = await detectStaleDocTargets(projectRoot, changedFiles);

  const recordedLane = readRecordedLane(projectRoot, sessionId, dirName);

  const checksReport = readChecksReportForFeature(projectRoot, dirName);
  const structuredTestResults =
    checksReport && checksReport.results.length > 0 ? checksReport.results : undefined;

  const diskMap = await readTraceabilityMapSafely(projectRoot);
  const changeMap = await buildAndWriteChangeTraceabilityMap(
    {
      projectRoot,
      dirName,
      changedFiles: changeEvidence.files.filter((filePath) => !isPaqadArtifactPath(filePath)),
      testResults: structuredTestResults,
      lane: recordedLane,
    },
    (message) => appendHooksLog(projectRoot, `verification: ${message}`),
  );
  const traceabilityMap = effectiveTraceabilityMap(changeMap.result?.map ?? null, diskMap);
  const pendingDecisions = readPendingDecisions(projectRoot);
  const specReview = await loadSpecReviewSafely(projectRoot);

  const acMapping = computeAcTestMapping({
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
    hasFrozenSpec: changeMap.result !== null || hasFrozenSpec(traceabilityMap),
    codeChanged,
  });

  const specBoundary = deriveSpecBoundary(traceabilityMap);

  const escalations: string[] = [];
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
    ac_test_mapping_passed: acMapping.passed,
    ac_test_mapping_detail: acMapping.detail,
    ac_test_mapping_outcome: acMapping.outcome,
    spec_review_passed: specReviewSignal.passed,
    ...(specReview ? { spec_review_on_record: true } : {}),
    ...(specReviewSignal.inconclusive
      ? { spec_review_inconclusive: true, spec_review_detail: specReviewSignal.detail }
      : {}),
    implementation_review_passed: implementationReview.passed,
    implementation_review_findings: implementationReview.findings,
    waiting_decisions: implementationReview.waiting,
    ...(checksReport ? { code_tests_lint_passed: checksReport.passed } : {}),
    quality_ratchet_result: qualityRatchetResult,
    ...mutation,
    lane: recordedLane,
    expected_ui_modules: [],
    expected_api_modules: [],
    expected_integration_modules: [],
    expected_error_catalog_modules: [],
    registry_refreshed_at: new Date().toISOString(),
    glossary_updated: true,
    unchecked_documentation_inputs: UNCHECKED_DOCUMENTATION_INPUTS,
  };

  return { context, escalations };
}

const UNCHECKED_DOCUMENTATION_INPUTS: readonly string[] = [
  'the registries',
  'the glossary',
  'the expected module docs',
];

function resolveActiveSessionId(projectRoot: string): string {
  return resolveSessionId(projectRoot, process.env.CLAUDE_SESSION_ID ?? null);
}

function readChangeStartPointSafe(projectRoot: string, dirName: string) {
  try {
    return readChangeStartPoint(projectRoot, dirName);
  } catch {
    return null;
  }
}

function resolveActiveFeatureDir(projectRoot: string, sessionId: string): string | null {
  try {
    return currentFeature(projectRoot, sessionId);
  } catch {
    return null;
  }
}

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

function hasFrozenSpec(map: TraceabilityMap | null): boolean {
  return map !== null && map.forward.some((link) => link.source === 'acceptance-criterion');
}

function readDeadCodeFiles(map: TraceabilityMap | null): string[] | null {
  if (map === null || !map.anchors_known) {
    return null;
  }
  return map.backward.filter((link) => link.role === 'orphan').map((link) => link.file);
}

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

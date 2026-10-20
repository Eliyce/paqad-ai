import { engineLog } from '@/core/logger-registry.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { isFrameworkEnabledForRoot } from '@/core/framework-enabled.js';
import {
  resolveEnterprisePolicy,
  writesLedger,
  type EnterprisePolicy,
} from '@/core/enterprise-policy.js';
import type { EngineEventBus } from '@/event-bus/engine-event-bus.js';
import type {
  VerificationContext,
  VerificationGate,
  VerificationOrigin,
} from '@/core/types/verification.js';
import type { EvidenceFileDigest, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { syncModuleHealthFromVerification } from '@/planning/module-health-updater.js';
import {
  computeChangeSubjectDigest,
  computeFileDigests,
  evidenceGatesToRows,
  gateResultsToRows,
  ratchetResultToRows,
  readReproducibilityPredicate,
  resolveChangeAuthorship,
  resolveComplianceCitations,
  type RowContext,
} from '@/evidence/index.js';
import { closeVerifiedChange, finalizeStageEvidence } from '@/stage-evidence/finalize.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import {
  appendChangeMetrics,
  appendFeatureEvidenceRows,
} from '@/feature-evidence/bundle-ledgers.js';
import { reuseCounts } from '@/feature-evidence/reuse.js';
import { writeFeatureDecisionsIndex } from '@/feature-evidence/decisions-index.js';
import { reconcileDeliveryFromGit } from '@/feature-evidence/delivery.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { BACKSTOP_WRITER } from '@/stage-evidence/agent-identity.js';
import { summarizeStageIsolation } from '@/stage-isolation/isolation-summary.js';
import { projectFeatureReceipt } from '@/feature-evidence/receipt.js';
import { featureReportEnabled, writeFeatureReport } from '@/feature-evidence/report-writer.js';
import {
  auditTurnNarration,
  isAgentNarratableStage,
  unnarratedAdvisory,
} from '@/stage-evidence/narration-audit.js';
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
import { changeIsFeatureDev } from '@/stage-evidence/scope.js';
import { runDuplicationScan } from '@/duplication/scan.js';
import { resolveDuplicationMode } from '@/duplication/config.js';
import { computeChangeMetrics, type ChangeMetrics } from '@/change-metrics/index.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { resolveRuleComplianceMode } from '@/kernel/capability.js';
import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { classifyCompletionEnforcement } from '@/pipeline/session-ownership.js';
import { recordNonFeatureVerificationSkip } from '@/session-ledger/non-feature-skip-audit.js';
import { PAQAD_STATUS_GLYPH, paqadFrameLead } from '@/core/constants/paqad-voice.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { type FoldedChange, type OrderingViolation } from '@/stage-evidence/types.js';
import type { VerifyResult } from '@/stage-evidence/verify.js';

import { VerificationGateRunner } from '../gate-runner.js';
import { buildVerificationEvidence, writeVerificationEvidence } from '../evidence.js';
import { evidenceExistenceGate } from './evidence-existence-gate.js';
import { resolveEvidenceExistenceMode } from './evidence-existence-mode.js';
import {
  bundleCompletenessGate,
  recheckAfterReceiptSeal,
  type BundleCompletenessGateInput,
} from './bundle-completeness-gate.js';
import { rulesLoadedGate } from './rules-loaded-gate.js';
import { resolveBundleCompletenessMode } from './bundle-completeness-mode.js';
import { visualEvidenceGate } from '../gates/visual-evidence.js';
import { resolveVisualEvidenceMode } from './visual-evidence-mode.js';
import { frontendTriggerOrFault } from '@/visual-evidence/trigger.js';

declare const __PKG_VERSION__: string;
function verifierVersion(): string {
  return typeof __PKG_VERSION__ === 'string' && __PKG_VERSION__ !== '__PKG_VERSION__'
    ? __PKG_VERSION__
    : '0.0.0-dev';
}
import type { Gate } from '../gates/gate.interface.js';
import { AcTestMappingGate } from '../gates/ac-test-mapping.js';
import { ChangeCompletenessGate } from '../gates/change-completeness.js';
import { DocumentationFreshnessGate } from '../gates/documentation-freshness.js';
import { DuplicationGate } from '../gates/duplication.js';
import { ExtensionSurfaceGate } from '../gates/extension-surface.js';
import { ImplementationReviewGate } from '../gates/implementation-review.js';
import { InstructionsDocsStructureGate } from '../gates/instructions-docs-structure.js';
import { ModuleDocsStructureGate } from '../gates/module-docs-structure.js';
import { MutationTestingGate } from '../gates/mutation-testing.js';
import { QualityRatchetGate } from '../gates/quality-ratchet.js';
import { SpecReviewGate } from '../gates/spec-review.js';

import {
  buildRepositoryVerificationContext,
  type BuildRepositoryVerificationContextOptions,
} from './repository-context.js';
import { composeChangeReceipt, unrecordedMandatoryStages } from './receipt.js';
import {
  buildRepositoryVerificationVerdict,
  formatVerdictSummary,
  type RepositoryVerificationVerdict,
} from './verdict.js';
import { buildBundleCompletenessConfig } from './bundle-completeness-config.js';
export {
  buildBundleCompletenessConfig,
  isolationConfig,
  readSpecPipelineFlags,
  stageIsolationExpected,
  stageIsolationStatus,
  type SpecPipelineFlags,
  type StageIsolationStatus,
} from './bundle-completeness-config.js';
import { verdictKindFor, type VerdictKind } from '@/verification/verdict-kind.js';

export function backstopGates(): Gate[] {
  return [
    new AcTestMappingGate(),
    new SpecReviewGate(),
    new ImplementationReviewGate(),
    new ChangeCompletenessGate(),
    new MutationTestingGate(),
    new QualityRatchetGate(),
    new DuplicationGate(),
    new ModuleDocsStructureGate(),
    new InstructionsDocsStructureGate(),
    new DocumentationFreshnessGate(),
    new ExtensionSurfaceGate(),
  ];
}

export interface RunRepositoryVerificationOptions extends BuildRepositoryVerificationContextOptions {
  eventBus?: EngineEventBus;
  prebuiltContext?: { context: VerificationContext; escalations: string[] };
  hostSessionId?: string | null;
  transcriptText?: string | null;
  now?: () => string;
}

export async function runRepositoryVerification(
  options: RunRepositoryVerificationOptions,
): Promise<RepositoryVerificationVerdict> {
  const now = options.now ?? (() => new Date().toISOString());

  if (!isFrameworkEnabledForRoot(options.projectRoot)) {
    const at = now();
    return {
      origin: options.origin,
      ok: true,
      summary: '✓ paqad disabled — verification skipped (vanilla mode).',
      gates: [],
      escalations: [],
      evidence_path: null,
      started_at: at,
      completed_at: at,
    };
  }

  if (options.origin === 'hook-completion') {
    const decision = classifyCompletionEnforcement(
      options.projectRoot,
      options.hostSessionId ?? null,
    );
    if (!decision.enforce) {
      recordNonFeatureVerificationSkip(options.projectRoot, {
        sessionId: options.hostSessionId ?? null,
        workflow: decision.activeWorkflow,
        origin: options.origin,
        reason: decision.reason,
      });
      const at = now();
      const detail =
        decision.reason === 'detour'
          ? `This turn ran the ${decision.activeWorkflow!} workflow and made no ` +
            `code change. The paused change is checked when it resumes.`
          : 'This session made no code change of its own, so there are no end-of-change ' +
            'checks to run.';
      return {
        origin: options.origin,
        ok: true,
        applicable: false,
        summary:
          `${paqadFrameLead('verification not applicable')}\n` +
          `> ${PAQAD_STATUS_GLYPH.skipped} ${detail}`,
        gates: [],
        escalations: [],
        evidence_path: null,
        started_at: at,
        completed_at: at,
      };
    }
  }

  const startedAt = now();

  const built =
    options.prebuiltContext ??
    (await buildRepositoryVerificationContext({
      projectRoot: options.projectRoot,
      origin: options.origin,
      mutationDeps: options.mutationDeps,
    }));
  const { context, escalations } = built;

  if (
    changeIsFeatureDev(context.changed_files, context.project_root) &&
    resolveDuplicationMode(context.project_root) !== 'off'
  ) {
    try {
      await runDuplicationScan({
        projectRoot: context.project_root,
        changedFiles: context.changed_files,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: duplication scan skipped (${message})`);
    }
  }

  const runner = new VerificationGateRunner(backstopGates());
  const results = await runner.run(context);
  const completedAt = now();

  await syncModuleHealthFromVerification({
    projectRoot: context.project_root,
    verificationContext: context,
    results,
  });

  const evidence = buildVerificationEvidence({
    results,
    context: {
      structured_test_results: context.structured_test_results,
      mutation_result: context.mutation_result,
    },
    run_id: `${context.verification_origin}-${startedAt}`,
    started_at: startedAt,
    completed_at: completedAt,
  });

  const origin = context.verification_origin ?? options.origin;
  const isFeatureDev = changeIsFeatureDev(context.changed_files, context.project_root);
  let stageResult: VerifyResult | null = null;
  try {
    const stageFileDigests = await computeFileDigests(context.project_root, context.changed_files);
    stageResult = finalizeStageEvidence(context.project_root, {
      adapter: BACKSTOP_WRITER,
      sessionId: options.hostSessionId ?? null,
      changedFilesCount: context.changed_files.length,
      subjectDigest: computeChangeSubjectDigest(stageFileDigests),
      isFeatureDevChange: isFeatureDev,
      deferClose: true,
      now: () => new Date(completedAt),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: stage-evidence finalize skipped (${message})`);
  }
  const stagesMode = resolveStagesMode(context.project_root);
  const stageGate = stageEvidenceGate(
    stageResult,
    origin,
    context.changed_files.length,
    stagesMode,
  );
  const directGates: VerificationEvidenceGate[] = [];
  if (stageGate) {
    evidence.gates.push(stageGate);
    directGates.push(stageGate);
    if (stageGate.status === 'fail') {
      evidence.overall_status = 'fail';
    }
  }

  const checksGate = checksEvidenceGate(context.structured_test_results);
  if (checksGate) {
    const existingIndex = evidence.gates.findIndex((gate) => gate.name === 'code-tests-lint');
    if (existingIndex >= 0) {
      evidence.gates[existingIndex] = checksGate;
    } else {
      evidence.gates.push(checksGate);
    }
    directGates.push(checksGate);
    if (checksGate.status === 'fail') {
      evidence.overall_status = 'fail';
      evidence.first_failure_gate ??= checksGate.name;
    }
  } else if (isFeatureDev && context.code_changed) {
    const inconclusiveGate = inconclusiveChecksGate();
    const existingIndex = evidence.gates.findIndex((gate) => gate.name === 'code-tests-lint');
    if (existingIndex >= 0) {
      evidence.gates[existingIndex] = inconclusiveGate;
    } else {
      /* c8 ignore next 2 -- defensive: the evidence builder always emits a
         `code-tests-lint` placeholder, so existingIndex is never -1 here (mirrors the
         checksGate branch above). Kept so a future builder change fails safe, not silently. */
      evidence.gates.push(inconclusiveGate);
    }
    directGates.push(inconclusiveGate);
  } else if (!context.code_changed) {
    evidence.gates = evidence.gates.map((gate) =>
      gate.name === 'code-tests-lint'
        ? {
            ...gate,
            detail: 'No code changed, so there were no tests to check.',
            skip_reason: 'no code changed',
            skip_kind: 'not-required' as const,
          }
        : gate,
    );
  }
  const checksVerified =
    (context.structured_test_results?.length ?? 0) > 0 && context.code_tests_lint_passed;

  let changeMetrics: ChangeMetrics | null = null;
  if (isFeatureDev && resolveFrameworkConfig(context.project_root).features.metrics_enabled) {
    try {
      changeMetrics = await computeChangeMetrics({
        projectRoot: context.project_root,
        changedFiles: context.changed_files,
      });
      appendChangeMetrics(
        context.project_root,
        resolveSessionId(context.project_root, options.hostSessionId ?? null),
        changeMetrics,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: change-metrics skipped (${message})`);
      changeMetrics = null;
    }
  }

  let evidencePath: string | null = null;
  try {
    evidencePath = await writeVerificationEvidence(evidence, {
      project_root: context.project_root,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not write verification-evidence.json (${message})`);
  }

  const policy = resolveEnterprisePolicy(readProjectProfile(context.project_root));
  const bundleSessionId = resolveSessionId(context.project_root, options.hostSessionId ?? null);
  const activeFeature = currentFeature(context.project_root, bundleSessionId);
  const bundleFeature =
    activeFeature &&
    !routeIsAffirmativelyNonFeature(context.project_root, options.hostSessionId ?? null)
      ? activeFeature
      : null;
  let lateGateRowTarget: { sessionId: string; ctx: RowContext } | null = null;
  let graded: {
    fileDigests: EvidenceFileDigest[];
    rows: EvidenceLedgerRow[];
    ctx: RowContext;
  } | null = null;
  try {
    const fileDigests = await computeFileDigests(context.project_root, context.changed_files);
    const subjectDigest = computeChangeSubjectDigest(fileDigests);
    const rowCtx = { subjectDigest, ts: completedAt };
    const rows = [
      ...gateResultsToRows(results, rowCtx),
      ...ratchetResultToRows(context.quality_ratchet_result, rowCtx),
    ];
    graded = { fileDigests, rows, ctx: rowCtx };
    if (bundleFeature) {
      appendFeatureEvidenceRows(context.project_root, bundleSessionId, rows);
      lateGateRowTarget = { sessionId: bundleSessionId, ctx: rowCtx };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not record evidence rows (${message})`);
  }
  const receiptPending = writesLedger(policy) && graded !== null && bundleFeature !== null;

  const reportPath = renderActiveFeatureReport(
    context.project_root,
    options.hostSessionId ?? null,
    completedAt,
    verifierVersion(),
  );

  const completenessSession = resolveSessionId(context.project_root, options.hostSessionId ?? null);
  const completenessActive = currentFeature(context.project_root, completenessSession);
  const completenessDir =
    completenessActive &&
    !routeIsAffirmativelyNonFeature(context.project_root, options.hostSessionId ?? null)
      ? completenessActive
      : null;
  const completenessMode = resolveBundleCompletenessMode(context.project_root);
  if (completenessDir) {
    try {
      writeFeatureDecisionsIndex(context.project_root, completenessDir, {
        sessionId: completenessSession,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: decisions index skipped (${message})`);
    }
  }
  let completenessFailed = false;
  const lateGates: VerificationEvidenceGate[] = [];
  const frameworkConfig = resolveFrameworkConfig(context.project_root);
  let completenessInput: BundleCompletenessGateInput | null = null;
  let completenessGate: VerificationEvidenceGate | null = null;
  if (completenessMode !== 'off') {
    if (completenessDir) {
      try {
        reconcileDeliveryFromGit(context.project_root, completenessDir, completedAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        engineLog('warn', `paqad: delivery reconcile skipped (${message})`);
      }
    }
    completenessInput = {
      projectRoot: context.project_root,
      sessionId: completenessSession,
      dirName: completenessDir,
      mode: completenessMode,
      origin,
      isFeatureDev,
      config: buildBundleCompletenessConfig(
        context.project_root,
        completenessSession,
        completenessDir,
      ),
      changeMetrics,
      evidenceRowsPending: lateGateRowTarget !== null,
      receiptPending,
    };
    completenessGate = bundleCompletenessGate(completenessInput);
    if (completenessGate) {
      evidence.gates.push(completenessGate);
      lateGates.push(completenessGate);
      if (completenessGate.status === 'fail') {
        completenessFailed = true;
        evidence.overall_status = 'fail';
        evidence.first_failure_gate ??= completenessGate.name;
      }
    }
  } else {
    const existenceMode = resolveEvidenceExistenceMode(context.project_root);
    if (existenceMode !== 'off') {
      const existenceGate = evidenceExistenceGate({
        projectRoot: context.project_root,
        sessionId: completenessSession,
        dirName: completenessDir,
        mode: existenceMode,
        isFeatureDev,
        ragEnabled: frameworkConfig.intelligence.rag_enabled,
        ruleComplianceOn: resolveRuleComplianceMode(context.project_root) !== 'off',
        duplicationOn: resolveDuplicationMode(context.project_root) !== 'off',
        metricsOn: frameworkConfig.features.metrics_enabled,
        changeMetrics,
      });
      if (existenceGate) {
        evidence.gates.push(existenceGate);
        lateGates.push(existenceGate);
      }
    }
  }
  const veProfile = readProjectProfile(context.project_root);
  const veFlagOn =
    frameworkConfig.features.visual_evidence &&
    (veProfile?.active_capabilities?.includes('coding') ?? false);
  const flagOnGates = veFlagOn ? ['visual-evidence' as VerificationGate] : [];
  {
    const veTrigger = frontendTriggerOrFault(context.project_root, context.changed_files);
    const veGate = visualEvidenceGate({
      projectRoot: context.project_root,
      dirName: completenessDir,
      mode: resolveVisualEvidenceMode(context.project_root),
      origin,
      isFeatureDev,
      flagOn: veFlagOn,
      frontendTriggered: veTrigger.triggered,
      packRegistryFault: veTrigger.fault,
    });
    if (veGate) {
      evidence.gates.push(veGate);
      lateGates.push(veGate);
      if (veGate.status === 'fail') {
        evidence.overall_status = 'fail';
        evidence.first_failure_gate ??= veGate.name;
      }
    }
  }

  {
    const rulesGate = await rulesLoadedGate({
      projectRoot: context.project_root,
      dirName: completenessDir,
      isFeatureDev,
      sessionId: completenessSession,
      origin,
    });
    if (rulesGate) {
      evidence.gates.push(rulesGate);
      lateGates.push(rulesGate);
      if (rulesGate.status === 'fail') {
        evidence.overall_status = 'fail';
        evidence.first_failure_gate ??= rulesGate.name;
      }
    }
  }

  const verdictGateRows = graded
    ? evidenceGatesToRows([...directGates, ...lateGates], graded.ctx)
    : [];
  if (lateGateRowTarget) {
    appendFeatureEvidenceRows(context.project_root, lateGateRowTarget.sessionId, verdictGateRows);
  }

  const fold = readChangeFold(context.project_root, options.hostSessionId ?? null);
  const verdictStageGaps =
    isFeatureDev && fold ? unrecordedMandatoryStages(fold, checksVerified) : [];

  if (graded && bundleFeature) {
    const stageGapRows =
      verdictStageGaps.length > 0
        ? evidenceGatesToRows([unrecordedStagesGate(verdictStageGaps)], graded.ctx)
        : [];
    appendFeatureEvidenceRows(context.project_root, bundleSessionId, stageGapRows);
    if (receiptPending) {
      const sealed = await sealBundleReceipt({
        projectRoot: context.project_root,
        dirName: bundleFeature,
        sessionId: bundleSessionId,
        policy,
        fileDigests: graded.fileDigests,
        rows: [...graded.rows, ...verdictGateRows, ...stageGapRows],
        timeVerified: completedAt,
        changeMetrics,
      });
      const rechecked = completenessInput
        ? recheckAfterReceiptSeal(completenessGate, completenessInput, sealed)
        : completenessGate;
      if (rechecked && completenessGate && rechecked !== completenessGate) {
        evidence.gates[evidence.gates.indexOf(completenessGate)] = rechecked;
        appendFeatureEvidenceRows(
          context.project_root,
          bundleSessionId,
          evidenceGatesToRows([rechecked], graded.ctx),
        );
        if (rechecked.status === 'fail') {
          completenessFailed = true;
          evidence.overall_status = 'fail';
          evidence.first_failure_gate ??= rechecked.name;
        }
      }
    }
  }

  try {
    evidencePath = await writeVerificationEvidence(evidence, {
      project_root: context.project_root,
    });
    /* v8 ignore next 4 -- best-effort: a re-write fault leaves the pre-gate artifact on disk;
       the in-memory verdict is unaffected and this path is not reproduced in tests. */
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not re-write verification-evidence.json (${message})`);
  }

  const verdict = buildRepositoryVerificationVerdict({
    origin: context.verification_origin ?? options.origin,
    evidence,
    escalations,
    evidencePath,
    flagOnGates,
    waitingDecisions: context.waiting_decisions,
  });
  verdict.reportPath = reportPath;

  verdict.narrationAdvisory = unnarratedAdvisory(
    auditTurnNarration({
      transcriptText: options.transcriptText ?? '',
      recorded: (fold?.stages ?? [])
        .filter((stage) => isAgentNarratableStage(stage.evidence_source))
        .map((stage) => stage.stage),
    }),
  );

  if (isFeatureDev && verdict.ok && fold) {
    const stageGaps = unrecordedMandatoryStages(fold, checksVerified);
    if (stageGaps.length > 0) {
      verdict.summary = formatVerdictSummary({
        ok: verdict.ok,
        gates: verdict.gates,
        escalations,
        unrecordedMandatoryStages: stageGaps,
        flagOnGates,
        waitingDecisions: context.waiting_decisions,
      });
    }
  }

  verdict.kind = verdictKindFor(verdict.gates, verdictStageGaps);
  if (verdictStageGaps.length > 0) {
    evidence.unrecorded_mandatory_stages = verdictStageGaps;
    try {
      await writeVerificationEvidence(evidence, {
        project_root: context.project_root,
      });
      /* v8 ignore next 4 -- best-effort: the in-memory verdict is unaffected */
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: could not record stage gaps in evidence (${message})`);
    }
  }

  const receiptFeature = currentFeature(
    context.project_root,
    resolveSessionId(context.project_root, options.hostSessionId ?? null),
  );

  verdict.receipt = composeChangeReceipt({
    verdictSummary: verdict.summary,
    fold,
    reportPath,
    reuse: reuseCounts(
      receiptFeature ? readFeaturePlan(context.project_root, receiptFeature) : null,
    ),
    checksVerified: isFeatureDev ? checksVerified : undefined,
    changeMetrics,
    isolation: receiptFeature
      ? summarizeStageIsolation(context.project_root, receiptFeature)
      : null,
  });

  if (reportPath) {
    renderActiveFeatureReport(
      context.project_root,
      options.hostSessionId ?? null,
      completedAt,
      verifierVersion(),
      verdict.kind,
    );
  }

  if (stageResult?.ok && !completenessFailed) {
    closeVerifiedChange(context.project_root, {
      sessionId: options.hostSessionId ?? null,
      adapter: BACKSTOP_WRITER,
      verdict: stageResult.verdict,
      now: () => new Date(completedAt),
    });
  }

  if (options.eventBus) {
    options.eventBus.emit({
      kind: 'verification-verdict',
      at: completedAt,
      origin: verdict.origin,
      ok: verdict.ok,
      summary: verdict.summary,
      gates: verdict.gates.map((gate) => ({
        gate: gate.gate,
        status: gate.status,
        detail: gate.detail,
      })),
      escalations: verdict.escalations,
    });
  }

  return verdict;
}

function readChangeFold(projectRoot: string, hostSessionId: string | null): FoldedChange | null {
  try {
    const sessionId = resolveSessionId(projectRoot, hostSessionId);
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) {
      return null;
    }
    return foldFeature(projectRoot, sessionId, dirName);
  } catch {
    return null;
  }
}

function renderActiveFeatureReport(
  projectRoot: string,
  hostSessionId: string | null,
  completedAt: string,
  paqadVersion: string,
  verdict?: VerdictKind,
): string | null {
  try {
    const sessionId = resolveSessionId(projectRoot, hostSessionId);
    const dirName = currentFeature(projectRoot, sessionId);
    if (
      !dirName ||
      !featureReportEnabled(projectRoot) ||
      routeIsAffirmativelyNonFeature(projectRoot, hostSessionId)
    ) {
      return null;
    }
    return writeFeatureReport(projectRoot, dirName, {
      sessionId,
      generatedAt: completedAt,
      paqadVersion,
      ...(verdict ? { verdict } : {}),
    }).path;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not render feature report (${message})`);
    return null;
  }
}

const STAGE_EVIDENCE_HARD_ORIGINS: ReadonlySet<VerificationOrigin> = new Set([
  'hook-completion',
  'git-backstop',
]);

export function describeOrderingViolations(violations: readonly OrderingViolation[]): string {
  return violations
    .map((violation) =>
      violation.before === violation.after
        ? `${violation.before} ended before it started`
        : `${violation.before} -> ${violation.after}`,
    )
    .join('; ');
}

export function stageEvidenceGate(
  result: VerifyResult | null,
  origin: VerificationOrigin,
  _changedFileCount: number,
  mode: StagesMode = 'strict',
): VerificationEvidenceGate | null {
  if (!result) {
    return null;
  }
  const name = 'stage-evidence' as VerificationGate;
  if (result.ok) {
    return {
      name,
      status: 'pass',
      detail: `Every mandatory feature-development stage was recorded in order (${result.verdict}).`,
      remediation: null,
      failures: [],
    };
  }
  const missing = result.missing_stages.join(', ');
  if (mode === 'strict' && STAGE_EVIDENCE_HARD_ORIGINS.has(origin)) {
    const lead = result.live_marked
      ? 'Feature-development workflow left incomplete'
      : 'Feature-development stages were not recorded for this change';
    const orderingOnly =
      result.missing_stages.length === 0 && result.ordering_violations.length > 0;
    return {
      name,
      status: 'fail',
      detail: orderingOnly
        ? `${lead} — stages ran out of order: ${describeOrderingViolations(result.ordering_violations)}.`
        : `${lead} — missing stage(s): [${missing}].`,
      remediation: orderingOnly
        ? 'Re-mark the stages so each one ends before the next begins, or resolve the redo via ' +
          'the Decision Pause Contract.'
        : 'Record each missing stage (open → start → end per stage), or set stages_mode=warn/off in ' +
          '.paqad/configs/.config.policy to adopt the workflow before enforcing, or resolve the redo ' +
          'via the Decision Pause Contract.',
      failures: [],
    };
  }
  return {
    name,
    status: 'skipped',
    detail: skippedDetail(mode, origin, missing, result.live_marked),
    remediation: null,
    failures: [],
    skip_kind: 'not-required',
  };
}

export function checksEvidenceGate(
  results: StructuredTestResult[] | undefined,
): VerificationEvidenceGate | null {
  if (!results || results.length === 0) {
    return null;
  }
  const name = 'code-tests-lint' as VerificationGate;
  const failing = results.find((result) => result.summary.failed > 0 || result.summary.errored > 0);
  if (failing) {
    return {
      name,
      status: 'fail',
      detail:
        `Checks failed — "${failing.summary.runner_id}" reported ` +
        `${failing.summary.failed} failing / ${failing.summary.errored} errored.`,
      remediation: 'Fix the failing build, test, or lint signal and re-run `paqad-ai checks run`.',
      failures: [],
    };
  }
  const totals = results.reduce(
    (aggregate, result) => {
      aggregate.total += result.summary.total;
      aggregate.passed += result.summary.passed;
      return aggregate;
    },
    { total: 0, passed: 0 },
  );
  return {
    name,
    status: 'pass',
    detail: `Deterministic checks passed (${totals.passed}/${totals.total}).`,
    remediation: null,
    failures: [],
  };
}

export function inconclusiveChecksGate(): VerificationEvidenceGate {
  return {
    name: 'code-tests-lint' as VerificationGate,
    status: 'inconclusive',
    detail:
      'No checks report on record — tests were not verified for this change. Run ' +
      '`paqad-ai checks run` so the checks stage is proven, or rely on CI.',
    remediation: 'Run `paqad-ai checks run` to persist a report the completion gate reads.',
    failures: [],
  };
}

function skippedDetail(
  mode: StagesMode,
  origin: VerificationOrigin,
  missing: string,
  liveMarked: boolean,
): string {
  if (mode === 'off') {
    return `Stage-evidence enforcement is disabled (stages_mode=off). Missing: [${missing}].`;
  }
  if (mode === 'warn') {
    return `Feature-development stages incomplete (missing [${missing}]) — warning only (stages_mode=warn).`;
  }
  return liveMarked
    ? `Stage-evidence incomplete (missing [${missing}]) — informational here; the local ledger is not committed for CI.`
    : `Feature-development stages were not recorded for this change (informational on ${origin}). Missing: [${missing}].`;
}

function unrecordedStagesGate(stages: readonly string[]): VerificationEvidenceGate {
  return {
    name: 'unrecorded-mandatory-stages' as VerificationGate,
    status: 'inconclusive',
    detail: `Mandatory stage(s) with no recorded evidence: [${stages.join(', ')}].`,
    remediation: null,
    failures: [],
  };
}

interface SealBundleReceiptInput {
  projectRoot: string;
  dirName: string;
  sessionId: string;
  policy: EnterprisePolicy;
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  timeVerified: string;
  changeMetrics: ChangeMetrics | null;
}

async function sealBundleReceipt(input: SealBundleReceiptInput): Promise<boolean> {
  const { policy, rows } = input;
  try {
    const authorship = await resolveChangeAuthorship({
      projectRoot: input.projectRoot,
      env: process.env,
    });
    const complianceCitations = policy.compliance_citations
      ? resolveComplianceCitations({ projectRoot: input.projectRoot, rows })
      : undefined;
    const reproducibility = readReproducibilityPredicate(input.projectRoot) ?? undefined;
    projectFeatureReceipt(input.projectRoot, input.dirName, {
      fileDigests: input.fileDigests,
      rows,
      verifierVersion: verifierVersion(),
      timeVerified: input.timeVerified,
      sessionId: input.sessionId,
      write: { receipt: policy.evidence_ledger, aiBom: policy.ai_bom },
      authorship,
      ...(complianceCitations !== undefined ? { complianceCitations } : {}),
      ...(reproducibility !== undefined ? { reproducibility } : {}),
      ...(input.changeMetrics
        ? {
            metrics: {
              dup_new_pct: input.changeMetrics.dup_new_pct,
              reuse_rate: input.changeMetrics.reuse_rate,
              meaningful_changed_lines: input.changeMetrics.meaningful_changed_lines,
            },
          }
        : {}),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not project evidence receipt (${message})`);
    return false;
  }
}

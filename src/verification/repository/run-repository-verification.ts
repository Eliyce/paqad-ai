// Issue #117 (C-1 + C-6) — the agent-independent verification entry point the
// hooks and the CI backstop call. Builds the repository context, runs the
// existing VerificationGateRunner over the gates the backstop can genuinely
// evaluate, writes the evidence artifact, optionally streams the verdict on the
// EngineEventBus, and returns one machine-readable trust verdict. No new CLI
// verb — this is a library function the generated hooks invoke.

import { engineLog } from '@/core/logger-registry.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { isFrameworkEnabledForRoot } from '@/core/framework-enabled.js';
import { resolveEnterprisePolicy, writesLedger } from '@/core/enterprise-policy.js';
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
import { finalizeStageEvidence } from '@/stage-evidence/finalize.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import {
  appendChangeMetrics,
  appendFeatureEvidenceRows,
} from '@/feature-evidence/bundle-ledgers.js';
import { reuseCounts } from '@/feature-evidence/reuse.js';
import { reconcileDeliveryFromGit } from '@/feature-evidence/delivery.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { BACKSTOP_WRITER } from '@/stage-evidence/agent-identity.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import { isSubagentCapableAdapter } from '@/stage-isolation/stage-agents.js';
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
import { layeredConfigMap, resolveFrameworkConfig } from '@/core/framework-config.js';
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
import { bundleCompletenessGate } from './bundle-completeness-gate.js';
import { rulesLoadedGate } from './rules-loaded-gate.js';
import { resolveBundleCompletenessMode } from './bundle-completeness-mode.js';
import { visualEvidenceGate } from '../gates/visual-evidence.js';
import { resolveVisualEvidenceMode } from './visual-evidence-mode.js';
import { frontendTriggerOrFault } from '@/visual-evidence/trigger.js';

// Injected at build time by tsup/vitest (see tsup.config.ts); the unreplaced
// placeholder is tolerated so a dev/test run still produces a receipt.
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

/**
 * The gates the backstop runs. It deliberately omits the pure model-judgment
 * gates — requirement-completeness, story-quality, architecture-compliance,
 * behavioral-correctness, database-quality, code-tests-lint — because those are
 * provider-workflow concerns the backstop cannot re-judge from artifacts (and
 * CI runs lint/test/typecheck as separate steps). The omitted gates report
 * `skipped` in the evidence rather than passing vacuously.
 *
 * Order matters: the specific computed gates (ac-test-mapping, spec-review,
 * implementation-review) run *before* the change-completeness roll-up so that
 * when one fails, the verdict names the precise cause (which AC, which decision)
 * rather than the roll-up's generic "blocked". The runner short-circuits after
 * the first failure, so the first failing gate is the one the developer reads.
 */
export function backstopGates(): Gate[] {
  return [
    new AcTestMappingGate(),
    new SpecReviewGate(),
    new ImplementationReviewGate(),
    new ChangeCompletenessGate(),
    new MutationTestingGate(),
    new QualityRatchetGate(),
    // Issue #358 — the duplication verdict. Placed after the quality gates (a near-copy is a
    // quality signal, not a correctness blocker) and, being blocking only in strict mode with a
    // deterministic finding, it never preempts a more critical gate in the default warn bake-in.
    new DuplicationGate(),
    new ModuleDocsStructureGate(),
    new InstructionsDocsStructureGate(),
    new DocumentationFreshnessGate(),
    new ExtensionSurfaceGate(),
  ];
}

export interface RunRepositoryVerificationOptions extends BuildRepositoryVerificationContextOptions {
  /** When supplied, the verdict is streamed as a `verification-verdict` event
   *  (issue #117 C-6) so the desktop/UI sees the same data the hook prints. */
  eventBus?: EngineEventBus;
  /** Pre-built context, for tests/callers that already have one. When omitted
   *  the context is built from repository reality. */
  prebuiltContext?: { context: VerificationContext; escalations: string[] };
  /** The host session id (Claude passes one on the Stop-hook stdin). Threaded to
   *  stage-evidence finalization so the completion seam writes under the SAME id
   *  as the live session's other ledgers — instead of falling back to a stale
   *  single-slot cache and fragmenting one session into two subdirs (buildout F5b,
   *  bug #5). Absent on hosts that supply no id (the cached/minted id is used). */
  hostSessionId?: string | null;
  /** The turn transcript (issue #409). When supplied, the verdict carries a
   *  `narrationAdvisory` naming any stage this change recorded that the agent never
   *  spoke in visible text — the mirror of the narrated-but-unrecorded gap (#389).
   *  Absent/empty reads as "cannot tell" and produces no advisory. */
  transcriptText?: string | null;
  now?: () => string;
}

/**
 * Run the verification backstop against repository reality and return the trust
 * verdict. Never throws on a gate failure — a failure is reported as
 * `verdict.ok === false`; the caller (hook/CI) decides the exit code.
 */
export async function runRepositoryVerification(
  options: RunRepositoryVerificationOptions,
): Promise<RepositoryVerificationVerdict> {
  const now = options.now ?? (() => new Date().toISOString());

  // Issue #220 — when paqad is disabled (or env-overridden off), the backstop is
  // a pure no-op: build no context, run no gates, and write nothing — no
  // verification-evidence, no module-health, no ledger/receipt, no audit.log or
  // session artifacts. It returns an `ok` verdict so no caller reads "off" as a
  // failure. The check is side-effect-free (no profile-migration write), so an
  // OFF turn leaves `git status` clean.
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

  // Issue #582 — session-owned end-of-turn enforcement (replaces the #499 route guess).
  // The IN-SESSION completion seam fires for every session on the project, but only the
  // session that made a change owes its checks. A session that owns no change (no
  // agent-authored stage row stamped with its id in an unclosed bundle), or an owner on a
  // non-feature detour that edited nothing this turn, is skipped here: AFTER the
  // enabled-check and BEFORE the context build, so no context, gate, inferred-git record,
  // bundle, evidence file, receipt, or `{decision:'block'}` is ever produced for it.
  //
  // Only at `hook-completion` origin: commit/push/CI stay purely path-based and never
  // read ownership or route. The ownership read never adopts another session's bundle.
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
      // A detour always names its active workflow: an owner with no recorded route enforces.
      const detail =
        decision.reason === 'detour'
          ? `This turn ran the ${decision.activeWorkflow!} workflow and made no ` +
            `code change. The paused change is checked when it resumes.`
          : 'This session made no code change of its own, so there are no end-of-change ' +
            'checks to run.';
      return {
        origin: options.origin,
        ok: true,
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
    }));
  const { context, escalations } = built;

  // Issue #358 — refresh the duplication report BEFORE the gates run, so the DuplicationGate
  // (in backstopGates) reads this change's result. Scoped to feature-development (a docs/
  // framework-internal diff is not code being built) and to a non-off duplication mode. Driven
  // here for the same reason module-health is (this is the universal, agent-independent
  // completion seam), and best-effort by contract: a scan failure is logged and never changes
  // the verdict (NFR-3).
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

  // Issue #80 — the backstop is the agent-independent verification chokepoint
  // (Claude Stop hook + git pre-commit/pre-push + CI), so it is also the place
  // to fold verification reality into each touched module's health profile.
  // Without this the profiles stay frozen at their onboarding stub because no
  // other code path runs in a consumer repo. syncModuleHealthFromVerification
  // owns its error handling — it returns a skipped result rather than throwing —
  // so a module-health failure can never change the trust verdict surfaced here.
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

  // Issue #247 — stage-evidence finalization + enforcement. The end-of-change gate
  // fires here (Claude Stop / git backstop / CI), reading the ledger files
  // deterministically (never an LLM claim). Placed AFTER the global enabled-check
  // and BEFORE the enterprise block below, so it runs regardless of the
  // enterprise/AI-BOM flags (C1). Best-effort — a failure never throws.
  //
  // The gate hard-FAILS only when the workflow was started but left incomplete
  // (live marks exist + a mandatory stage missing) at a LOCAL origin. When the
  // workflow was never marked, or on CI (no committed local ledger), it is
  // informational (`skipped`), so it can never break a project that has not adopted
  // stage marking, nor a fresh CI checkout. Added to `evidence.gates` BEFORE the
  // artifact is written so the receipt and the verdict agree.
  const origin = context.verification_origin ?? options.origin;
  // Scope (issue #310): the feature-development completeness gate — and the #368
  // checks-evidence honesty below — apply only to a feature-development change. A
  // documentation-only / framework-internal diff is not a feature being built.
  const isFeatureDev = changeIsFeatureDev(context.changed_files, context.project_root);
  let stageResult: VerifyResult | null = null;
  try {
    const stageFileDigests = await computeFileDigests(context.project_root, context.changed_files);
    stageResult = finalizeStageEvidence(context.project_root, {
      adapter: BACKSTOP_WRITER,
      // Buildout F5b (#5) — use the live host session id when the hook supplied
      // one, so the completion seam writes under the same session as the prompt
      // seam instead of a stale cached id. Null falls back to the cache as before.
      sessionId: options.hostSessionId ?? null,
      changedFilesCount: context.changed_files.length,
      subjectDigest: computeChangeSubjectDigest(stageFileDigests),
      isFeatureDevChange: isFeatureDev,
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
  if (stageGate) {
    evidence.gates.push(stageGate);
    if (stageGate.status === 'fail') {
      evidence.overall_status = 'fail';
    }
  }

  // Issue #318 — the deterministic checks verdict. `code-tests-lint` is not one of
  // the model-judgment gates the runner replays, so the evidence builder lists it
  // as `skipped`. When the deterministic check report is present we REPLACE that
  // skipped placeholder with the real result (`paqad-ai checks run` produced it):
  // a red report blocks the completion verdict ("Needs your attention"), a green
  // one passes. An absent report leaves the placeholder skipped, so the run reads
  // Inconclusive (via the escalation) — never a vacuous green on unrun tests.
  const checksGate = checksEvidenceGate(context.structured_test_results);
  if (checksGate) {
    const existingIndex = evidence.gates.findIndex((gate) => gate.name === 'code-tests-lint');
    if (existingIndex >= 0) {
      evidence.gates[existingIndex] = checksGate;
    } else {
      evidence.gates.push(checksGate);
    }
    if (checksGate.status === 'fail') {
      evidence.overall_status = 'fail';
      evidence.first_failure_gate ??= checksGate.name;
    }
  } else if (isFeatureDev && context.code_changed) {
    // Issue #368 (AC-A2) — a feature-development code change with NO checks report has
    // no proof its tests ran. Leaving `code-tests-lint` as the vacuous `skipped`
    // placeholder let the headline read "Safe to merge" on unverified tests. Record it
    // INCONCLUSIVE instead, so the verdict is "Inconclusive" (verdict.ok=false) — the
    // change is loudly not-done, never a silent green. This is surfaced (always, via the
    // #368 receipt) but does NOT hard-block: Inconclusive is "do not over-trust", not a
    // failing gate. Replaces the skipped placeholder in place so there is one row.
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
  }
  // Issue #368 — does a passing `paqad-ai checks run` report back this change? Used by
  // the receipt to render the `checks` stage honestly (🟡 "tests not verified" when not).
  const checksVerified =
    (context.structured_test_results?.length ?? 0) > 0 && context.code_tests_lint_passed;

  // Issue #362 — the per-change shape metrics, folded over the caches the gates already
  // produced (the duplication report refreshed above + the code-knowledge index). Computed
  // only for a feature-development change and only when `metrics_enabled` (default on). It
  // reads caches + the changed-file content, no second scan, and is best-effort by contract:
  // a failure degrades to no metrics and NEVER changes the verdict (INV-1).
  let changeMetrics: ChangeMetrics | null = null;
  if (isFeatureDev && resolveFrameworkConfig(context.project_root).features.metrics_enabled) {
    try {
      changeMetrics = await computeChangeMetrics({
        projectRoot: context.project_root,
        changedFiles: context.changed_files,
      });
      // Issue #468 Phase C — the metrics are recorded ONLY in the active feature's
      // `change-metrics.jsonl` bundle file now (the collector + `metrics report` read the
      // bundle window since Phase B); the retired project-scoped change-metrics ledger
      // write is gone. A no-op when no feature is active; inside this best-effort try/catch,
      // so it cannot change the verdict.
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

  // Issue #118 — fan the graded gate (and ratchet measure) results into the
  // unified evidence ledger, then project a signed per-change receipt + AI-BOM.
  // Never block verification on a ledger/receipt failure: a missing receipt is a
  // weaker trust signal, not a verdict.
  //
  // Issue #581 — the bundle's evidence.jsonl is always on: the graded rows land in the active
  // feature's bundle whatever the enterprise toggles, so every change records one row per gate
  // that ran. Only the receipt that seals those rows and the AI-BOM stay enterprise capabilities
  // (issue #187): they resolve the policy once and skip the whole receipt block when nothing is
  // enabled, so a normal user pays zero tokens (no citation resolution).
  const policy = resolveEnterprisePolicy(readProjectProfile(context.project_root));
  // Issue #390 — no bundle write for a route we can prove is non-feature-development, even if
  // a pointer is active. No active feature (a framework-internal change, or none open) simply
  // skips the bundle writes.
  const bundleSessionId = resolveSessionId(context.project_root, options.hostSessionId ?? null);
  const activeFeature = currentFeature(context.project_root, bundleSessionId);
  const bundleFeature =
    activeFeature &&
    !routeIsAffirmativelyNonFeature(context.project_root, options.hostSessionId ?? null)
      ? activeFeature
      : null;
  // Issue #579 — where the late gates (bundle-completeness, visual-evidence, rules-loaded) land
  // in the bundle's evidence.jsonl. Set below under the same scope as the graded rows; those
  // gates run after this block, so their rows are appended at the end.
  let lateGateRowTarget: { sessionId: string; ctx: RowContext } | null = null;
  let graded: {
    fileDigests: EvidenceFileDigest[];
    rows: EvidenceLedgerRow[];
  } | null = null;
  try {
    const fileDigests = await computeFileDigests(context.project_root, context.changed_files);
    const subjectDigest = computeChangeSubjectDigest(fileDigests);
    const rowCtx = { subjectDigest, ts: completedAt };
    const rows = [
      ...gateResultsToRows(results, rowCtx),
      ...ratchetResultToRows(context.quality_ratchet_result, rowCtx),
    ];
    graded = { fileDigests, rows };
    if (bundleFeature) {
      // Issue #468 — the graded rows land in the active feature's `evidence.jsonl`. Written
      // BEFORE the receipt below, which seals the file as it stands (issue #581).
      appendFeatureEvidenceRows(context.project_root, bundleSessionId, rows);
      lateGateRowTarget = { sessionId: bundleSessionId, ctx: rowCtx };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not record evidence rows (${message})`);
  }
  if (writesLedger(policy) && graded && bundleFeature) {
    const { fileDigests, rows } = graded;
    try {
      // Issue #120 — fold change authorship (which adapter/model wrote it, who
      // accepted it) into the receipt so the attestation is gate-derived yet
      // producer-attributed. Resolution never throws; absent authorship simply
      // omits the predicate field.
      const authorship = await resolveChangeAuthorship({
        projectRoot: context.project_root,
        env: process.env,
      });
      // Issue #122 — cite which legal clauses each passing gate produces evidence
      // toward, from the active compliance packs. Empty (→ field omitted) when no
      // pack is installed. This is the token-spending path, so it only runs when
      // `compliance_citations` is on (issue #187) — otherwise the receipt omits
      // the field. Issue #123 — fold in the reproducibility stamp the session
      // recorded, when present. Both degrade to absent, never throw.
      const complianceCitations = policy.compliance_citations
        ? resolveComplianceCitations({ projectRoot: context.project_root, rows })
        : undefined;
      const reproducibility = readReproducibilityPredicate(context.project_root) ?? undefined;
      // Issue #468 Phase C — the per-feature bundle is the ONLY receipt/evidence projection
      // now; the retired top-level `.paqad/ledger/{evidence.jsonl,receipts.jsonl,
      // receipt.dsse.json,ai-bom.json}` writes are gone (every reader re-pointed to the
      // bundle union in Phase B). The authorship/compliance/reproducibility resolved above
      // now feed only the bundle receipt below.
      //
      // Issue #343 B — project the per-feature receipt + AI-BOM into the active feature's
      // bundle from the graded rows, honouring the enterprise flags (`evidence_ledger` →
      // receipt.json, `ai_bom` → ai-bom.json). The receipt seals evidence.jsonl rather than
      // copying its rows (issue #581).
      projectFeatureReceipt(context.project_root, bundleFeature, {
        fileDigests,
        rows,
        verifierVersion: verifierVersion(),
        timeVerified: completedAt,
        write: { receipt: policy.evidence_ledger, aiBom: policy.ai_bom },
        // Issue #468 Phase B — carry the authorship/compliance/reproducibility resolved
        // above so the per-feature receipt is a complete attestation record now that it is
        // the only one (D5). Each is omitted when absent.
        authorship,
        ...(complianceCitations !== undefined ? { complianceCitations } : {}),
        ...(reproducibility !== undefined ? { reproducibility } : {}),
        // Issue #362 — carry the metrics block on the bundle receipt predicate (AC-3).
        ...(changeMetrics
          ? {
              metrics: {
                dup_new_pct: changeMetrics.dup_new_pct,
                reuse_rate: changeMetrics.reuse_rate,
                meaningful_changed_lines: changeMetrics.meaningful_changed_lines,
              },
            }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: could not project evidence receipt (${message})`);
    }
  }

  // Issue #371 — render the per-feature HTML evidence report from the bundle on disk.
  // A pure projection: it renders whatever exists (plan/spec/stages always; receipt +
  // AI-BOM only when enterprise wrote them, otherwise a graceful empty-state note), so it
  // is deliberately NOT gated on the enterprise flags — only on `feature_report` (default
  // on). Best-effort and placed AFTER the receipt/AI-BOM projection so it renders the
  // freshest bundle: a render failure is logged and NEVER changes the verdict or exit code.
  const reportPath = renderActiveFeatureReport(
    context.project_root,
    options.hostSessionId ?? null,
    completedAt,
    verifierVersion(),
  );

  // Issue #511 — the fail-closed bundle-completeness gate. Placed LAST, after every writer
  // (the receipt/AI-BOM projection and the report render above), so report.html / receipt.json
  // exist on disk when it checks them. It reads the declarative bundle manifest and, under
  // `strict` (default), FAILS the change when a required file is missing/empty/invalid —
  // naming the file and its writer — blocking via the same Stop-hook `overall_status:'fail'`
  // path the stage-evidence gate uses. `warn` surfaces it as Inconclusive without blocking;
  // `off` falls back to the deprecated (warn-only) evidence-existence gate. Same scope guard
  // as before (feature-dev + active bundle + not affirmatively non-feature), so a non-feature
  // turn skips it entirely. Best-effort: the gate swallows its own read/backfill errors.
  const completenessSession = resolveSessionId(context.project_root, options.hostSessionId ?? null);
  const completenessActive = currentFeature(context.project_root, completenessSession);
  const completenessDir =
    completenessActive &&
    !routeIsAffirmativelyNonFeature(context.project_root, options.hostSessionId ?? null)
      ? completenessActive
      : null;
  const completenessMode = resolveBundleCompletenessMode(context.project_root);
  // Issue #579 — every late gate pushed below, skips included, for the evidence.jsonl rows.
  const lateGates: VerificationEvidenceGate[] = [];
  const frameworkConfig = resolveFrameworkConfig(context.project_root);
  if (completenessMode !== 'off') {
    // Issue #511 (RC-2.2) — reconcile delivery.json from local git before the gate, so a
    // mid-turn commit is linked even where no post-commit hook fired (advisory hosts, CI
    // clones). Best-effort — a git fault never changes the verdict.
    if (completenessDir) {
      try {
        reconcileDeliveryFromGit(context.project_root, completenessDir, completedAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        engineLog('warn', `paqad: delivery reconcile skipped (${message})`);
      }
    }
    const completenessGate = bundleCompletenessGate({
      projectRoot: context.project_root,
      sessionId: completenessSession,
      dirName: completenessDir,
      mode: completenessMode,
      origin,
      isFeatureDev,
      config: {
        ruleComplianceOn: resolveRuleComplianceMode(context.project_root) !== 'off',
        metricsEnabled: frameworkConfig.features.metrics_enabled,
        duplicationOn: resolveDuplicationMode(context.project_root) !== 'off',
        featureReport: frameworkConfig.features.feature_report,
        ragEnabled: frameworkConfig.intelligence.rag_enabled,
        enterprise: policy.enabled,
        evidenceLedger: policy.evidence_ledger,
        aiBom: policy.ai_bom,
        // Issue #547 (FR-10.1). Read via layeredConfigMap (not src/spec-pipeline) so the FR-11
        // import ban holds: src/verification/** must not import the pipeline.
        specPipelineStrict: (() => {
          const map = layeredConfigMap(context.project_root);
          const truthy = new Set(['1', 'true', 'yes', 'on']);
          const enabled = truthy.has((map.get('spec_pipeline_enabled') ?? '').trim().toLowerCase());
          return enabled && (map.get('spec_pipeline_adoption') ?? 'warn').trim() === 'strict';
        })(),
        // Issue #573 — was stage isolation EXPECTED for this change? Read from the bundle's
        // own open row (lane + recorded host adapter), never from config: whether isolation
        // applied is a property of the change, not a project setting. Fails toward silence —
        // an unresolved lane yields false, so the requirement cannot false-fail (INV-5).
        stageIsolationExpected: stageIsolationExpected(
          context.project_root,
          completenessSession,
          completenessDir,
        ),
      },
      changeMetrics,
    });
    if (completenessGate) {
      evidence.gates.push(completenessGate);
      lateGates.push(completenessGate);
      if (completenessGate.status === 'fail') {
        evidence.overall_status = 'fail';
        evidence.first_failure_gate ??= completenessGate.name;
      }
    }
  } else {
    // Deprecated fallback (issue #468 Phase C): the warn-only evidence-existence gate. Only
    // runs when the completeness gate is explicitly disabled, so a team can stay on the old
    // non-blocking behaviour by setting bundle_completeness=off.
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
  // Issue #551 — the visual-evidence gate. Same seam + local-origin scope as bundle-completeness:
  // it reads the git-ignored visual-evidence.json a capture run wrote and turns it into pass /
  // skipped / inconclusive|fail. Off (flag off or coding absent) → skipped, never a block.
  const veProfile = readProjectProfile(context.project_root);
  const veFlagOn =
    frameworkConfig.features.visual_evidence &&
    (veProfile?.active_capabilities?.includes('coding') ?? false);
  // Issue #579 — a flag-on gate that skipped prints its own skip line in the verdict summary.
  const flagOnGates = veFlagOn ? ['visual-evidence' as VerificationGate] : [];
  {
    // Issue #579 — an empty pack registry with frameworks declared is an install fault the
    // gate must report, never a silent not-frontend.
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

  // Issue #557 — the rule-loading gate. A feature-development code change whose applicable
  // rules were never loaded FAILS (blocks via overall_status:'fail', the same Stop-hook path
  // as stage-evidence); a stale load reads Inconclusive without blocking. Scoped to a
  // feature-dev change with an active bundle (same completenessDir scope as bundle-completeness),
  // so a non-feature turn records nothing.
  {
    const rulesGate = await rulesLoadedGate({
      projectRoot: context.project_root,
      dirName: completenessDir,
      isFeatureDev,
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

  // Issue #579 — record the late gates in the bundle's evidence.jsonl too, so a skipped or
  // failed visual-evidence / completeness / rules-loaded gate is on the ledger, not only in the
  // session verdict. Same target (and so the same scope) as the graded rows above, and like them
  // always on whatever the enterprise toggles (issue #581). Appended after the receipt sealed the
  // file, which is why the receipt records how many lines it sealed. Best-effort, never throws.
  if (lateGateRowTarget) {
    appendFeatureEvidenceRows(
      context.project_root,
      lateGateRowTarget.sessionId,
      evidenceGatesToRows(lateGates, lateGateRowTarget.ctx),
    );
  }

  // Re-write the evidence artifact so the file reflects the completeness gate appended after
  // the first write above. Best-effort — the verdict below reads the in-memory evidence
  // regardless, so a re-write failure never changes what the developer sees.
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
  });
  verdict.reportPath = reportPath;

  const fold = readChangeFold(context.project_root, options.hostSessionId ?? null);

  // Issue #409 — the voice backstop. The fold proves which stages RAN; the transcript
  // shows which the agent actually SAID. Any gap is reported so the model can put the
  // receipt where the developer can see it. Advisory only: it never touches
  // `verdict.ok`, so a silent-but-correct change still passes (INV-1).
  //
  // Issue #449 — only stages the AGENT authored (live-mark/redo) can be "recorded but
  // never said out loud". A hook/backstop-inferred stage (e.g. the inferred-git
  // `development` row) was never the agent's claim, so filter those out before the audit
  // rather than accuse the agent of failing to narrate work it never asserted.
  verdict.narrationAdvisory = unnarratedAdvisory(
    auditTurnNarration({
      transcriptText: options.transcriptText ?? '',
      recorded: (fold?.stages ?? [])
        .filter((stage) => isAgentNarratableStage(stage.evidence_source))
        .map((stage) => stage.stage),
    }),
  );

  // Issue #472 — reconcile the receipt: when a feature-development change's gates all pass
  // but a mandatory stage has no evidence, the "Safe to merge" headline over-claims relative
  // to the per-stage block (which shows the stage 🟡/🔴). Recompute the verdict WORD to
  // Inconclusive (the over-trust guard) so `verdict.summary`, the composed receipt, and the
  // event stream all agree with the block. `verdict.ok` is left gate-derived, so exit codes
  // and warn-mode non-blocking semantics are untouched: a strict-mode gap already fails the
  // stage-evidence gate (verdict.ok=false), so this branch is skipped and the headline is
  // already "Needs your attention".
  if (isFeatureDev && verdict.ok && fold) {
    const stageGaps = unrecordedMandatoryStages(fold, checksVerified);
    if (stageGaps.length > 0) {
      verdict.summary = formatVerdictSummary({
        ok: verdict.ok,
        gates: verdict.gates,
        escalations,
        unrecordedMandatoryStages: stageGaps,
        flagOnGates,
      });
    }
  }

  const receiptFeature = currentFeature(
    context.project_root,
    resolveSessionId(context.project_root, options.hostSessionId ?? null),
  );

  // Issue #325 — compose the ONE end-of-change receipt: the branded verdict headline
  // plus the per-stage evidence block (with honest provenance). Best-effort — if the
  // fold cannot be read the receipt is just the verdict summary, never a throw.
  verdict.receipt = composeChangeReceipt({
    verdictSummary: verdict.summary,
    fold,
    reportPath,
    // Issue #357 (AC-5) — surface what the plan declared it reused. The feature is
    // resolved here rather than reused from the enterprise receipt block above, which is
    // gated on `evidence_ledger` and may never run. Both reads are tolerant, and
    // `reuseCounts` returns null for a plan compiled before the reuse gate, so the
    // planning line is unchanged for those.
    reuse: reuseCounts(
      receiptFeature ? readFeaturePlan(context.project_root, receiptFeature) : null,
    ),
    // Issue #368 (AC-A2) — only when this is a feature-dev change do we assert the
    // checks stage needs a report; for a docs/framework change the checks stage is
    // not part of the promise, so leave the line unchanged (undefined).
    checksVerified: isFeatureDev ? checksVerified : undefined,
    // Issue #362 — the change-shape line, present only for feature-development changes.
    changeMetrics,
  });

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

/**
 * Read the folded stage evidence for the current change (issue #325 receipt), or
 * null when no change is open or it cannot be read. Best-effort — the receipt
 * degrades to the verdict summary alone rather than throwing.
 */
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

/**
 * Render the active feature's HTML evidence report (issue #371), returning its absolute
 * path, or null when no feature is active, the `feature_report` flag is off, or rendering
 * failed. Best-effort by contract: it swallows every error so a broken render can never
 * change the verification verdict or the process exit code.
 */
function renderActiveFeatureReport(
  projectRoot: string,
  hostSessionId: string | null,
  completedAt: string,
  paqadVersion: string,
): string | null {
  try {
    const sessionId = resolveSessionId(projectRoot, hostSessionId);
    const dirName = currentFeature(projectRoot, sessionId);
    // Issue #390 — never render report.html for a route we can prove is
    // non-feature-development, even if a pointer leaked through to an active bundle.
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
    }).path;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not render feature report (${message})`);
    return null;
  }
}

/** Local origins (the agent's own machine) where the stage-evidence ledger is
 *  present, so its incompleteness can be enforced as a hard failure. `ci-backstop`
 *  is excluded: a fresh CI checkout has no committed ledger. */
const STAGE_EVIDENCE_HARD_ORIGINS: ReadonlySet<VerificationOrigin> = new Set([
  'hook-completion',
  'git-backstop',
]);

/**
 * Map the deterministic stage-evidence verdict to a verification gate (issue #247,
 * buildout F4 — the RCA closure). The gate's `name` is the `stage-evidence`
 * marker; it is appended to the evidence after the formal gate framework, so it
 * never has to be a registered `VERIFICATION_GATES` member.
 *
 * The decision is mode-gated (`stages_mode`, default `strict` per decision D3),
 * NO LONGER conditioned on `result.live_marked` — that condition was structurally
 * always false (no live-mark writer has a caller) and is exactly why a
 * `cannot-verify` change used to ship. `live_marked` now only flavours the
 * message (started-but-incomplete vs never-recorded).
 *
 * - No change record this session (`stageResult === null`) → no gate. The
 *   empty-turn guard is the ledger record itself (supplied by
 *   `finalizeStageEvidence`: null on a genuine no-op/read-only turn), NOT the
 *   working-tree diff count — a committed-but-incomplete change has a clean tree
 *   yet must still fail, so the old `changedFileCount <= 0` short-circuit (which
 *   let a committed incomplete change ship a vacuous pass) is gone.
 * - `complete` / `recovered` → `pass`.
 * - Incomplete/blocked at a LOCAL origin in `strict` → `fail` (the real teeth).
 * - `off` (escape hatch), `warn`, or any non-local origin (CI has no committed
 *   ledger) → `skipped` (informational; never breaks a fresh CI checkout, and
 *   `off`/`warn` let a team adopt the workflow before turning the teeth on).
 */
/**
 * Whether stage isolation was expected for a change (issue #573): a graduated or full lane
 * on a host that can dispatch subagents. Both facts are the bundle's own session constants
 * (`feature.json`, else a pre-#581 bundle's open row), so a change is judged by what it
 * actually recorded.
 *
 * Returns false for an unresolved lane. That is deliberate — `repository-context` fails
 * safe to 'full' for OTHER purposes, but here a null lane must not manufacture a blocking
 * requirement out of nothing (INV-5).
 */
export function stageIsolationExpected(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): boolean {
  if (!sessionId || !dirName) return false;
  try {
    const { lane, adapter } = readChangeConstants(projectRoot, dirName);
    if (lane !== 'graduated' && lane !== 'full') return false;
    return isSubagentCapableAdapter(adapter, STAGE_AGENT_HOSTS);
  } catch {
    // A missing or unreadable bundle cannot prove isolation was expected, and must not
    // invent a blocking requirement.
    return false;
  }
}

/**
 * Render ordering violations as `before -> after` pairs for a gate message (issue #573).
 * A self-inverted stage (its own end before its own start) reports as `stage -> itself`,
 * which is exactly how it reads in the ledger.
 */
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
  // Retained for signature/call-site stability. No longer gates: the gate now
  // triggers on the presence of a stage-evidence change record (`result`), not
  // the working-tree diff count, so a committed (clean-tree) incomplete change
  // still fails instead of vacuously passing.
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
    // Issue #573 — name the condition that ACTUALLY failed. `computeVerdict` returns
    // 'incomplete' for a missing stage OR an ordering violation, but this message only ever
    // printed the missing list, so an ordering failure read as the literal, unactionable
    // `missing stage(s): []`. `ordering_violations` was already on the result and simply
    // never read.
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
  };
}

/**
 * Map the deterministic check report (issue #318) to the `code-tests-lint`
 * verification gate. Appended to the evidence directly (like the stage-evidence
 * gate) rather than run through the model-judgment gate runner, because the
 * signal is a command's exit code, not a re-judged artifact.
 *
 * - No structured results (`paqad-ai checks run` was not run, or nothing was
 *   mapped) → `null`: the gate is omitted and the run reads Inconclusive via the
 *   context escalation. Never a vacuous pass on unrun tests.
 * - Any result reporting a failure/error → `fail` (the completion verdict blocks).
 * - All results passing → `pass`.
 */
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

/**
 * The `code-tests-lint` gate as INCONCLUSIVE (issue #368, AC-A2) — used when a
 * feature-development code change carries no `paqad-ai checks run` report. An
 * inconclusive gate flips `verdict.ok` to false so the headline reads "Inconclusive"
 * (never a vacuous "Safe to merge" on unverified tests), yet it is not a hard `fail`,
 * so the #368 Stop-hook enforcement surfaces it without blocking the turn.
 */
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

/** Compose the informational `skipped` detail, explaining WHY the gate did not bite. */
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
  // strict, but a non-local origin (CI) where the local ledger is not committed.
  return liveMarked
    ? `Stage-evidence incomplete (missing [${missing}]) — informational here; the local ledger is not committed for CI.`
    : `Feature-development stages were not recorded for this change (informational on ${origin}). Missing: [${missing}].`;
}

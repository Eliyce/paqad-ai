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
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { syncModuleHealthFromVerification } from '@/planning/module-health-updater.js';
import {
  appendEvidenceRows,
  computeChangeSubjectDigest,
  computeFileDigests,
  gateResultsToRows,
  projectReceipt,
  ratchetResultToRows,
  readReproducibilityPredicate,
  resolveChangeAuthorship,
  resolveComplianceCitations,
} from '@/evidence/index.js';
import { finalizeStageEvidence } from '@/stage-evidence/finalize.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { projectFeatureReceipt } from '@/feature-evidence/receipt.js';
import { featureReportEnabled, writeFeatureReport } from '@/feature-evidence/report-writer.js';
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
import { changeIsFeatureDev } from '@/stage-evidence/scope.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { type FoldedChange } from '@/stage-evidence/types.js';
import type { VerifyResult } from '@/stage-evidence/verify.js';

import { VerificationGateRunner } from '../gate-runner.js';
import { buildVerificationEvidence, writeVerificationEvidence } from '../evidence.js';

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
import { composeChangeReceipt } from './receipt.js';
import {
  buildRepositoryVerificationVerdict,
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

  const startedAt = now();

  const built =
    options.prebuiltContext ??
    (await buildRepositoryVerificationContext({
      projectRoot: options.projectRoot,
      origin: options.origin,
    }));
  const { context, escalations } = built;

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
      adapter: 'backstop',
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
  // Issue #187 — the whole ledger is an opt-in enterprise capability, off by
  // default. Resolve the policy once and skip the entire block when nothing is
  // enabled, so a normal user pays zero tokens (no citation resolution) and
  // writes no `.paqad/ledger/` files. Sub-flags gate each write independently.
  const policy = resolveEnterprisePolicy(readProjectProfile(context.project_root));
  if (writesLedger(policy)) {
    try {
      const fileDigests = await computeFileDigests(context.project_root, context.changed_files);
      const subjectDigest = computeChangeSubjectDigest(fileDigests);
      const rowCtx = { subjectDigest, ts: completedAt };
      const rows = [
        ...gateResultsToRows(results, rowCtx),
        ...ratchetResultToRows(context.quality_ratchet_result, rowCtx),
      ];
      if (policy.evidence_ledger) {
        appendEvidenceRows(context.project_root, rows);
      }
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
      await projectReceipt({
        projectRoot: context.project_root,
        fileDigests,
        rows,
        verifierVersion: verifierVersion(),
        timeVerified: completedAt,
        authorship,
        complianceCitations,
        reproducibility,
        env: process.env,
        write: { evidenceReceipt: policy.evidence_ledger, aiBom: policy.ai_bom },
      });
      // Issue #343 B — also project the per-feature receipt + AI-BOM into the active
      // feature's bundle from the SAME graded rows, honouring the SAME enterprise flags
      // (`evidence_ledger` → receipt.json, `ai_bom` → ai-bom.json). Best-effort: no active
      // feature (a framework-internal change, or none open) simply skips the bundle write.
      const activeFeature = currentFeature(
        context.project_root,
        resolveSessionId(context.project_root, options.hostSessionId ?? null),
      );
      if (activeFeature) {
        projectFeatureReceipt(context.project_root, activeFeature, {
          fileDigests,
          rows,
          verifierVersion: verifierVersion(),
          timeVerified: completedAt,
          write: { receipt: policy.evidence_ledger, aiBom: policy.ai_bom },
        });
      }
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

  const verdict = buildRepositoryVerificationVerdict({
    origin: context.verification_origin ?? options.origin,
    evidence,
    escalations,
    evidencePath,
  });
  verdict.reportPath = reportPath;

  // Issue #325 — compose the ONE end-of-change receipt: the branded verdict headline
  // plus the per-stage evidence block (with honest provenance). Best-effort — if the
  // fold cannot be read the receipt is just the verdict summary, never a throw.
  verdict.receipt = composeChangeReceipt({
    verdictSummary: verdict.summary,
    fold: readChangeFold(context.project_root, options.hostSessionId ?? null),
    reportPath,
    // Issue #368 (AC-A2) — only when this is a feature-dev change do we assert the
    // checks stage needs a report; for a docs/framework change the checks stage is
    // not part of the promise, so leave the line unchanged (undefined).
    checksVerified: isFeatureDev ? checksVerified : undefined,
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
    if (!dirName || !featureReportEnabled(projectRoot)) {
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
    return {
      name,
      status: 'fail',
      detail: `${lead} — missing stage(s): [${missing}].`,
      remediation:
        'Record each missing stage (open → start → end per stage), or set stages_mode=warn/off in ' +
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

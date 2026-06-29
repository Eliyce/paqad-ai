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
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineLog('warn', `paqad: could not project evidence receipt (${message})`);
    }
  }

  const verdict = buildRepositoryVerificationVerdict({
    origin: context.verification_origin ?? options.origin,
    evidence,
    escalations,
    evidencePath,
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
 * - No result, or no code diff → no gate (the gate is code-change-only).
 * - `complete` / `recovered` → `pass`.
 * - Incomplete/blocked at a LOCAL origin in `strict` → `fail` (the real teeth).
 * - `off` (escape hatch), `warn`, or any non-local origin (CI has no committed
 *   ledger) → `skipped` (informational; never breaks a fresh CI checkout, and
 *   `off`/`warn` let a team adopt the workflow before turning the teeth on).
 */
export function stageEvidenceGate(
  result: VerifyResult | null,
  origin: VerificationOrigin,
  changedFileCount: number,
  mode: StagesMode = 'strict',
): VerificationEvidenceGate | null {
  if (!result || changedFileCount <= 0) {
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

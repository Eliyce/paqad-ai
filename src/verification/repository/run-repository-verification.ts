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
import type { VerificationContext } from '@/core/types/verification.js';
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

// Issue #117 (C-1 + C-6) — the agent-independent verification entry point the
// hooks and the CI backstop call. Builds the repository context, runs the
// existing VerificationGateRunner over the gates the backstop can genuinely
// evaluate, writes the evidence artifact, optionally streams the verdict on the
// EngineEventBus, and returns one machine-readable trust verdict. No new CLI
// verb — this is a library function the generated hooks invoke.

import { engineLog } from '@/core/logger-registry.js';
import type { EngineEventBus } from '@/event-bus/engine-event-bus.js';
import type { VerificationContext } from '@/core/types/verification.js';
import {
  appendEvidenceRows,
  computeChangeSubjectDigest,
  computeFileDigests,
  gateResultsToRows,
  projectReceipt,
  ratchetResultToRows,
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
  try {
    const fileDigests = await computeFileDigests(context.project_root, context.changed_files);
    const subjectDigest = computeChangeSubjectDigest(fileDigests);
    const rowCtx = { subjectDigest, ts: completedAt };
    const rows = [
      ...gateResultsToRows(results, rowCtx),
      ...ratchetResultToRows(context.quality_ratchet_result, rowCtx),
    ];
    appendEvidenceRows(context.project_root, rows);
    await projectReceipt({
      projectRoot: context.project_root,
      fileDigests,
      rows,
      verifierVersion: verifierVersion(),
      timeVerified: completedAt,
      env: process.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: could not project evidence receipt (${message})`);
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

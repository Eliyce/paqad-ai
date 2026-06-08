import type {
  FixChange,
  FixProtocolResult,
  GreenBaseline,
  ProofCheck,
  ProofRunResult,
  RegressionGuard,
} from '@/core/types/fix-protocol.js';
import { REGRESSION_GUARD_SCHEMA_VERSION } from '@/core/types/fix-protocol.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';
import type { VerificationEvidenceFailure } from '@/core/types/verification-evidence.js';

import { affectsBehaviour } from './affects-behaviour.js';
import { detectRegression } from './baseline.js';
import { assessProofGenuineness, proofPassesAfterFix } from './proof.js';
import { writeRegressionGuard } from './regression-guard.js';

export interface RunFixProtocolInput {
  project_root: string;
  defect_id: string;
  /** The edits this fix will make — used by the behaviour classifier. */
  change: FixChange;
  /** The proof check that reproduces the defect. */
  proof: ProofCheck;
  /** The pre-fix green baseline (resolve via `resolveGreenBaseline`). */
  baseline: GreenBaseline;
  /** The captured failing-proof evidence to persist in the regression guard. */
  failing_evidence: VerificationEvidenceFailure;
  /** Acceptance criterion this fix is tied to, if any. */
  linked_ac_id?: string | null;
  /** ISO timestamp stamped on the persisted guard. */
  now: string;

  // Injected, tool-agnostic effects (issue #103 Settled decision: tool-agnostic):
  /** Step 1 — run the proof against the *unfixed* tree (must fail to be genuine). */
  runProofOnUnfixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  /** Step 2 — apply the fix. Only invoked after the proof is proven genuine. */
  applyFix: () => Promise<void>;
  /** Step 3 — run the proof against the *fixed* tree (must now pass). */
  runProofOnFixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  /** Step 4 — run the full suite after the fix and return its issue snapshots. */
  runFullSuiteAfterFix: () => Promise<TestIssueSnapshot[]>;
}

/**
 * Enforces the four-step fix protocol for one confirmed problem:
 * **prove broken → fix → prove fixed → prove nothing else broke**, then keeps
 * the proof as a regression guard.
 *
 * The proof-first steps are skipped only when the change genuinely cannot
 * affect behaviour; otherwise a fix cannot be marked done without a proof that
 * failed before and passes after, with no previously-passing check now failing
 * (issue #103 acceptance criteria). The function is pure orchestration over
 * injected effects, so it is tool-agnostic and the ordering is enforced:
 * `applyFix` runs only after the proof is proven genuine on the unfixed tree.
 */
export async function runFixProtocol(input: RunFixProtocolInput): Promise<FixProtocolResult> {
  const affects = affectsBehaviour(input.change);

  // The narrow skip door: cosmetic changes stay light — no proof, no suite run.
  if (!affects.affects) {
    await input.applyFix();
    return {
      status: 'skipped-no-behaviour-change',
      reason: affects.reason,
      affects_behaviour: affects,
    };
  }

  // Step 1 — prove broken (and prove the proof is genuine on the unfixed tree).
  const unfixedRun = await input.runProofOnUnfixedTree(input.proof);
  const genuine = assessProofGenuineness(input.proof, unfixedRun);
  if (!genuine.genuine) {
    return {
      status: 'rejected-proof-not-genuine',
      reason: genuine.reason,
      affects_behaviour: affects,
      proof_genuine: genuine,
    };
  }

  // Step 2 — fix.
  await input.applyFix();

  // Step 3 — prove fixed.
  const fixedRun = await input.runProofOnFixedTree(input.proof);
  const passesNow = proofPassesAfterFix(input.proof, fixedRun);
  if (!passesNow.passes) {
    return {
      status: 'rejected-proof-still-failing',
      reason: passesNow.reason,
      affects_behaviour: affects,
      proof_genuine: genuine,
    };
  }

  // Step 4 — prove nothing else broke.
  const afterFix = await input.runFullSuiteAfterFix();
  const regression = detectRegression(input.baseline.issues, afterFix);
  if (regression.regressed) {
    return {
      status: 'rejected-regression',
      reason: `Fix rejected: ${regression.newly_failing.length + regression.newly_errored.length} previously-passing check(s) now fail.`,
      affects_behaviour: affects,
      proof_genuine: genuine,
      regression,
    };
  }

  // Keep the proof: persist the durable regression guard.
  const guard: RegressionGuard = {
    schema_version: REGRESSION_GUARD_SCHEMA_VERSION,
    defect_id: input.defect_id,
    created_at: input.now,
    proof: {
      test_id: input.proof.test_id,
      test_file: input.proof.test_file,
      command: input.proof.command,
    },
    failing_evidence: input.failing_evidence,
    linked_ac_id: input.linked_ac_id ?? null,
  };
  const guardPath = await writeRegressionGuard(input.project_root, guard);

  return {
    status: 'fixed',
    reason: `Defect ${input.defect_id} fixed: proof failed before and passes after, with no regression.`,
    affects_behaviour: affects,
    proof_genuine: genuine,
    regression,
    guard_path: guardPath,
  };
}

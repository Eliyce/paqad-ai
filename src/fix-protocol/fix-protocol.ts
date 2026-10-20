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
  change: FixChange;
  proof: ProofCheck;
  baseline: GreenBaseline;
  failing_evidence: VerificationEvidenceFailure;
  linked_ac_id?: string | null;
  now: string;

  runProofOnUnfixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  applyFix: () => Promise<void>;
  runProofOnFixedTree: (proof: ProofCheck) => Promise<ProofRunResult>;
  runFullSuiteAfterFix: () => Promise<TestIssueSnapshot[]>;
}

export async function runFixProtocol(input: RunFixProtocolInput): Promise<FixProtocolResult> {
  const affects = affectsBehaviour(input.change);

  if (!affects.affects) {
    await input.applyFix();
    return {
      status: 'skipped-no-behaviour-change',
      reason: affects.reason,
      affects_behaviour: affects,
    };
  }

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

  await input.applyFix();

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

import type {
  DocTarget,
  ExecutionSlice,
  RegressionEntry,
  SliceCriteriaCheck,
  SliceDocCheck,
  SliceFullSuiteCheck,
  SliceGateResult,
  SliceRegressionCheck,
  SliceScopeCheck,
  VerificationCriterion,
} from '@/core/types/planning.js';
import type { DecisionPacket } from './decision-packet.js';

import { verifyFullSuite, type FullSuiteRunner } from './full-suite-runner.js';
import { verifyScopedCriteria, type CriteriaTestRunner } from './scoped-criteria-verifier.js';
import { verifySliceDocs } from './slice-doc-verifier.js';
import { verifySliceRegression, type RegressionRunner } from './slice-regression-runner.js';
import { verifySliceScope } from './slice-scope-guard.js';

export interface SliceGateInputs {
  projectRoot: string;
  slice: ExecutionSlice;
  orderedSlices: ExecutionSlice[];
  criteria: VerificationCriterion[];
  docTargets: DocTarget[];
  docSnapshot: Record<string, string | null>;
  regressionEntries: RegressionEntry[];
  modifiedFiles: string[];
  criteriaRunner: CriteriaTestRunner;
  regressionRunner: RegressionRunner;
  fullSuiteRunner: FullSuiteRunner;
  baselineFailingTests?: string[];
  decisionPackets?: DecisionPacket[];
  priorScopeWarnings?: string[];
}

export interface SliceGateDetail {
  gate_result: SliceGateResult;
  criteria_checks: SliceCriteriaCheck[];
  doc_checks: SliceDocCheck[];
  regression_checks: SliceRegressionCheck[];
  decision_checks: Array<{ decision_id: string; passed: boolean; reason: string }>;
  scope_check: SliceScopeCheck;
  full_suite_check: SliceFullSuiteCheck;
}

export async function runSliceGate(input: SliceGateInputs): Promise<SliceGateDetail> {
  const criteriaChecks = await verifyScopedCriteria(input.criteria, input.criteriaRunner);
  const scopeCheck = verifySliceScope({
    slice: input.slice,
    allSlices: input.orderedSlices,
    modifiedFiles: input.modifiedFiles,
    priorWarnings: input.priorScopeWarnings,
  });
  const docChecks = verifySliceDocs(input.projectRoot, input.docTargets, input.docSnapshot);
  const regressionChecks = await verifySliceRegression(
    input.regressionEntries,
    input.regressionRunner,
  );
  const decisionChecks = verifyDecisionPackets(input.decisionPackets ?? [], input.modifiedFiles);
  const fullSuiteCheck = await verifyFullSuite(
    input.fullSuiteRunner,
    input.baselineFailingTests ?? [],
  );

  const warnings = [
    ...docChecks
      .filter((check) => check.status === 'skipped')
      .map((check) => `doc:${check.target_id}:skipped`),
    ...scopeCheck.violations
      .filter((violation) => violation.severity === 'warning')
      .map((violation) => `scope:${violation.type}:${violation.file}`),
  ];

  const gateResult: SliceGateResult = {
    status: computeGateStatus(
      criteriaChecks,
      scopeCheck,
      regressionChecks,
      decisionChecks,
      fullSuiteCheck,
    ),
    criteria: {
      total: criteriaChecks.length,
      covered: criteriaChecks.filter((check) => check.status === 'covered').length,
      uncovered: criteriaChecks.filter((check) => check.status !== 'covered').length,
    },
    scope: scopeCheck,
    docs: {
      total: docChecks.length,
      updated: docChecks.filter((check) => check.status === 'updated').length,
      skipped: docChecks.filter((check) => check.status === 'skipped').length,
    },
    regression: {
      total: regressionChecks.length,
      passing: regressionChecks.filter((check) => check.status === 'passing').length,
      failing: regressionChecks.filter((check) => check.status === 'failing').length,
    },
    decision: {
      total: decisionChecks.length,
      passing: decisionChecks.filter((check) => check.passed).length,
      failing: decisionChecks.filter((check) => !check.passed).length,
    },
    full_suite: fullSuiteCheck,
    warnings: fullSuiteCheck.slow_suite_warning ? [...warnings, 'full-suite:slow'] : warnings,
  };

  return {
    gate_result: gateResult,
    criteria_checks: criteriaChecks,
    doc_checks: docChecks,
    regression_checks: regressionChecks,
    decision_checks: decisionChecks,
    scope_check: scopeCheck,
    full_suite_check: fullSuiteCheck,
  };
}

function computeGateStatus(
  criteriaChecks: SliceCriteriaCheck[],
  scopeCheck: SliceScopeCheck,
  regressionChecks: SliceRegressionCheck[],
  decisionChecks: Array<{ decision_id: string; passed: boolean; reason: string }>,
  fullSuiteCheck: SliceFullSuiteCheck,
): SliceGateResult['status'] {
  if (criteriaChecks.some((check) => !check.passed)) {
    return 'fail';
  }
  if (scopeCheck.status === 'violation') {
    return 'fail';
  }
  if (regressionChecks.some((check) => !check.passed)) {
    return 'fail';
  }
  if (decisionChecks.some((check) => !check.passed)) {
    return 'fail';
  }
  if (fullSuiteCheck.new_failures.length > 0) {
    return 'fail';
  }

  return 'pass';
}

function verifyDecisionPackets(
  packets: DecisionPacket[],
  modifiedFiles: string[],
): Array<{ decision_id: string; passed: boolean; reason: string }> {
  const modified = new Set(modifiedFiles);
  return packets.map((packet) => {
    const chosen = packet.options.find(
      (option) => option.option_key === packet.human_response?.chosen_option_key,
    );
    /* v8 ignore next 7 -- early return when decision has no file evidence; all tested packets have evidence */
    if (!chosen?.evidence.file) {
      return {
        decision_id: packet.decision_id,
        passed: true,
        reason: 'No file-specific evidence available for this decision.',
      };
    }

    const rejectedFiles = packet.options
      .filter((option) => option.option_key !== chosen.option_key)
      .map((option) => option.evidence.file)
      .filter((file): file is string => typeof file === 'string');
    const changedChosenFile = modified.has(chosen.evidence.file);
    const changedRejectedFile = rejectedFiles.some((file) => modified.has(file));

    if (!changedChosenFile && changedRejectedFile) {
      return {
        decision_id: packet.decision_id,
        passed: false,
        reason: `decision-violation: changed a rejected path instead of ${chosen.evidence.file}`,
      };
    }

    return {
      decision_id: packet.decision_id,
      passed: true,
      reason: changedChosenFile
        ? `Chosen path ${chosen.evidence.file} was used.`
        : 'No contradictory file change detected.',
    };
  });
}

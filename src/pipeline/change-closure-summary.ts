import type { ChangeClosureSummary, PhaseResult } from '@/core/types/pipeline.js';
import type { GateResult, VerificationContext } from '@/core/types/verification.js';

import { isCanonicalDocPath, isCodeFile, isTestFile } from './change-evidence.js';

export interface BuildChangeClosureSummaryInput {
  changed_files: string[];
  phases: PhaseResult[];
  verification_results?: GateResult[];
  verification_context?: VerificationContext;
}

export function buildChangeClosureSummary(
  input: BuildChangeClosureSummaryInput,
): ChangeClosureSummary {
  const codeChanged = input.changed_files.some((filePath) => isCodeFile(filePath));
  const testEvidenceChanged =
    input.changed_files.some((filePath) => isTestFile(filePath)) ||
    (input.verification_context?.structured_test_results?.length ?? 0) > 0;
  const canonicalDocsChanged = input.changed_files.some((filePath) => isCanonicalDocPath(filePath));
  const blockingGate = input.verification_results?.find((result) => !result.passed) ?? null;
  const blockingPhase = input.phases.find((phase) => phase.status === 'fail') ?? null;
  const primaryBlockingReason = blockingGate
    ? `${blockingGate.gate}: ${blockingGate.detail}`
    : (blockingPhase?.summary ?? null);
  const blocked = primaryBlockingReason !== null;

  return {
    code_changed: codeChanged,
    test_evidence_changed: testEvidenceChanged,
    canonical_docs_changed: canonicalDocsChanged,
    blocked,
    primary_blocking_reason: primaryBlockingReason,
    summary: blocked
      ? `Closure summary: code changed=${yesNo(codeChanged)}; test evidence changed=${yesNo(testEvidenceChanged)}; canonical docs changed=${yesNo(canonicalDocsChanged)}; blocked=yes; primary blocker=${primaryBlockingReason}.`
      : `Closure summary: code changed=${yesNo(codeChanged)}; test evidence changed=${yesNo(testEvidenceChanged)}; canonical docs changed=${yesNo(canonicalDocsChanged)}; blocked=no.`,
  };
}

function yesNo(value: boolean): 'yes' | 'no' {
  return value ? 'yes' : 'no';
}

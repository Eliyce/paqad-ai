import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  GateResult,
  VerificationContext,
  VerificationGate,
} from '@/core/types/verification.js';
import { VERIFICATION_GATES } from '@/core/types/verification.js';
import type {
  EvidenceFailureCategory,
  EvidenceGateStatus,
  EvidenceOverallStatus,
  VerificationEvidence,
  VerificationEvidenceFailure,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence.js';
import { VERIFICATION_EVIDENCE_SCHEMA_VERSION } from '@/core/types/verification-evidence.js';
import type {
  StructuredTestIssue,
  StructuredTestResult,
  TestIssueCategory,
} from '@/core/types/test-output.js';
import { extractAcIdFromIssue } from '@/verification/gates/ac-test-mapping.js';

export const VERIFICATION_EVIDENCE_RELATIVE_PATH = '.paqad/session/verification-evidence.json';
export const VERIFICATION_EVIDENCE_STDERR_BUDGET_BYTES = 2048;

export interface BuildVerificationEvidenceInput {
  results: GateResult[];
  context: Pick<VerificationContext, 'structured_test_results'>;
  run_id: string;
  started_at: string;
  completed_at: string;
}

export function buildVerificationEvidence(
  input: BuildVerificationEvidenceInput,
): VerificationEvidence {
  const resultByGate = new Map<VerificationGate, GateResult>();
  for (const result of input.results) {
    resultByGate.set(result.gate, result);
  }

  const testFailures = collectTestFailures(input.context.structured_test_results ?? []);

  const gates: VerificationEvidenceGate[] = VERIFICATION_GATES.map((gate) => {
    const result = resultByGate.get(gate);
    if (!result) {
      return {
        name: gate,
        status: 'skipped' satisfies EvidenceGateStatus,
        detail: 'Gate did not run.',
        remediation: null,
        failures: [],
      };
    }

    const status = mapGateStatus(result);
    const failures = gate === 'code-tests-lint' ? testFailures : [];

    return {
      name: gate,
      status,
      detail: result.detail,
      remediation: result.remediation ?? null,
      failures,
    };
  });

  const firstFailureGate = gates.find(
    (gate) => gate.status === 'fail' || gate.status === 'inconclusive',
  );
  const overallStatus: EvidenceOverallStatus = firstFailureGate ? 'fail' : 'pass';

  return {
    schema_version: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    run_id: input.run_id,
    started_at: input.started_at,
    completed_at: input.completed_at,
    overall_status: overallStatus,
    first_failure_gate: firstFailureGate?.name ?? null,
    gates,
  };
}

export interface WriteVerificationEvidenceOptions {
  project_root: string;
}

export async function writeVerificationEvidence(
  evidence: VerificationEvidence,
  options: WriteVerificationEvidenceOptions,
): Promise<string> {
  const targetPath = join(options.project_root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, targetPath);

  return targetPath;
}

function mapGateStatus(result: GateResult): EvidenceGateStatus {
  if (result.passed) {
    return 'pass';
  }
  if (result.inconclusive) {
    return 'inconclusive';
  }
  return 'fail';
}

function collectTestFailures(
  structuredResults: StructuredTestResult[],
): VerificationEvidenceFailure[] {
  const failures: VerificationEvidenceFailure[] = [];
  for (const result of structuredResults) {
    for (const issue of result.failures) {
      failures.push(toEvidenceFailure(issue));
    }
    for (const issue of result.errors) {
      failures.push(toEvidenceFailure(issue));
    }
  }
  return failures;
}

function toEvidenceFailure(issue: StructuredTestIssue): VerificationEvidenceFailure {
  const message = issue.message;
  const stderrSource = issue.stack_trace ?? issue.message;
  const stderrExcerpt = truncateForBudget(stderrSource, VERIFICATION_EVIDENCE_STDERR_BUDGET_BYTES);
  const acId = extractAcIdFromIssue(issue);

  return {
    category: mapTestCategory(issue.category),
    file: issue.file_path,
    line: issue.line_number,
    test_id: issue.test_id || null,
    suite: issue.suite,
    ac_id: acId,
    message,
    stderr_excerpt: stderrExcerpt,
  };
}

function mapTestCategory(category: TestIssueCategory): EvidenceFailureCategory {
  if (category === 'error') return 'test-error';
  if (category === 'timeout') return 'test-timeout';
  if (category === 'assertion' || category === 'unknown') return 'test-failure';
  return 'test-failure';
}

function truncateForBudget(value: string, budgetBytes: number): string | null {
  if (!value) {
    return null;
  }
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= budgetBytes) {
    return value;
  }
  return buffer.subarray(0, budgetBytes).toString('utf8');
}

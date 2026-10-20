import type { DoneInput, DoneResult } from '@/core/types/feature-spec.js';

export const TASTE_FINDING_KIND = 'taste';

export function isDone(input: DoneInput): DoneResult {
  const failingCriteria = input.acceptance_criteria
    .filter((criterion) => !criterion.proof_passing)
    .map((criterion) => criterion.criterion_id);

  const blockingFindings = input.findings
    .filter((finding) => finding.confirmed && finding.kind !== TASTE_FINDING_KIND)
    .map((finding) => finding.id);

  const done =
    input.gates_passed &&
    input.acceptance_criteria.length > 0 &&
    failingCriteria.length === 0 &&
    blockingFindings.length === 0;

  return {
    done,
    gates_passed: input.gates_passed,
    failing_criteria: failingCriteria,
    blocking_findings: blockingFindings,
  };
}

export function renderDefinitionOfDone(input: DoneInput): string {
  const result = isDone(input);
  const total = input.acceptance_criteria.length;
  const proven = total - result.failing_criteria.length;
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');

  const lines = [
    '# Definition of Done',
    '',
    `- [${mark(result.gates_passed)}] Verification gates pass`,
    `- [${mark(total > 0 && result.failing_criteria.length === 0)}] Every acceptance criterion implemented and proven (${proven}/${total})`,
    `- [${mark(result.blocking_findings.length === 0)}] No confirmed blocking problem (style/taste never blocks)`,
    '',
    `Result: ${result.done ? 'DONE' : 'NOT DONE'}`,
  ];

  if (!result.done) {
    if (total === 0) {
      lines.push('Blocked: no acceptance criteria to prove.');
    }
    if (result.failing_criteria.length > 0) {
      lines.push(`Failing acceptance criteria: ${result.failing_criteria.join(', ')}.`);
    }
    if (result.blocking_findings.length > 0) {
      lines.push(`Blocking findings: ${result.blocking_findings.join(', ')}.`);
    }
  }

  return `${lines.join('\n')}\n`;
}

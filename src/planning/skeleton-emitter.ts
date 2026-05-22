import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { VerificationCase, VerificationCriterion } from '@/core/types/planning.js';

export async function emitTestSkeletons(
  root: string,
  criteria: VerificationCriterion[],
  stack: string,
): Promise<string[]> {
  const automated = criteria.filter(
    (criterion) =>
      criterion.proof_type === 'automated' &&
      criterion.status === 'uncovered' &&
      criterion.proof_target !== undefined,
  );
  const grouped = new Map<string, VerificationCriterion[]>();

  for (const criterion of automated) {
    const proofTarget = criterion.proof_target!;
    const current = grouped.get(proofTarget) ?? [];
    current.push(criterion);
    grouped.set(proofTarget, current);
  }

  const written: string[] = [];
  for (const [proofTarget, group] of grouped) {
    const absolutePath = join(root, proofTarget);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderSkeletonFile(group, stack), 'utf8');
    written.push(proofTarget);
  }

  return written.sort();
}

function renderSkeletonFile(criteria: VerificationCriterion[], stack: string): string {
  const cases = criteria.map((criterion) => renderCriterionBlock(criterion)).join('\n\n');
  return `import { describe, it } from 'vitest';

// Generated planning skeleton for ${stack}
describe('Planning manifest obligations', () => {
${indent(cases, 2)}
});
`;
}

function renderCriterionBlock(criterion: VerificationCriterion): string {
  const blocks = [
    renderTestCase(
      criterion.criterion_id,
      `${criterion.given} / ${criterion.when} / ${criterion.then}`,
    ),
    ...renderVerificationCases(criterion.criterion_id, 'negative', criterion.negative_cases),
    ...renderVerificationCases(criterion.criterion_id, 'edge', criterion.edge_cases),
    ...renderVerificationCases(criterion.criterion_id, 'adversarial', criterion.adversarial_cases),
  ];
  return blocks.join('\n\n');
}

function renderVerificationCases(
  criterionId: string,
  label: string,
  cases: VerificationCase[] | undefined,
): string[] {
  return (cases ?? []).map((entry, index) =>
    renderTestCase(
      criterionId,
      `${label} case ${index + 1}: ${entry.input} => ${entry.expected_behavior}`,
    ),
  );
}

function renderTestCase(criterionId: string, title: string): string {
  return `it(${JSON.stringify(title)}, () => {
  // @obligation ${criterionId}
  throw new Error('Not implemented');
});`;
}

function indent(value: string, spaces: number): string {
  return value
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n');
}

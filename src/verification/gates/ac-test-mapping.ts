import type { StructuredTestIssue, StructuredTestResult } from '@/core/types/test-output.js';

import type { Gate } from './gate.interface.js';

import { createFail, createPass } from './shared.js';

export const AC_ID_PATTERN = /AC-\d+(?:\.\d+)?/;

export function extractAcIdFromIssue(issue: StructuredTestIssue): string | null {
  const candidates = [issue.test_id, issue.suite ?? ''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = AC_ID_PATTERN.exec(candidate);
    if (match) {
      return match[0];
    }
  }
  return null;
}

export function collectObservedAcIds(structuredResults: StructuredTestResult[]): string[] {
  const observed = new Set<string>();
  for (const result of structuredResults) {
    for (const issue of result.failures) {
      const acId = extractAcIdFromIssue(issue);
      if (acId) observed.add(acId);
    }
    for (const issue of result.errors) {
      const acId = extractAcIdFromIssue(issue);
      if (acId) observed.add(acId);
    }
  }
  return [...observed].sort();
}

export class AcTestMappingGate implements Gate {
  readonly gate = 'ac-test-mapping' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    if (!context.ac_test_mapping_passed) {
      return createFail(
        this.gate,
        'Acceptance criteria are missing test mappings',
        'Add or update the test-per-AC mapping.',
      );
    }

    const observed = collectObservedAcIds(context.structured_test_results ?? []);
    const detail =
      observed.length > 0
        ? `Acceptance criteria map to tests (observed in failing tests: ${observed.join(', ')})`
        : 'Acceptance criteria map to tests';

    return createPass(this.gate, detail);
  }
}

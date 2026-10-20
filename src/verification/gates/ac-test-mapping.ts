import type { StructuredTestIssue, StructuredTestResult } from '@/core/types/test-output.js';

import type { Gate } from './gate.interface.js';

import { createDidNotRun, createFail, createNotRequired, createPass } from './shared.js';

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
    const detail = context.ac_test_mapping_detail;

    if (!context.ac_test_mapping_passed || context.ac_test_mapping_outcome === 'fail') {
      return createFail(
        this.gate,
        detail ?? 'Acceptance criteria are missing test mappings',
        'Add a test that names each listed criterion id in its title, describe title or an `@obligation` tag.',
      );
    }

    if (context.ac_test_mapping_outcome === 'not-required') {
      return createNotRequired(
        this.gate,
        detail ?? 'No frozen spec, so no acceptance criteria to map.',
      );
    }

    if (context.ac_test_mapping_outcome === 'did-not-run' || detail === undefined) {
      return createDidNotRun(
        this.gate,
        detail ?? 'No acceptance-criteria map was built, so no criterion was checked.',
      );
    }

    const observed = collectObservedAcIds(context.structured_test_results ?? []);
    return createPass(
      this.gate,
      observed.length > 0 ? `${detail} Observed in failing tests: ${observed.join(', ')}.` : detail,
    );
  }
}

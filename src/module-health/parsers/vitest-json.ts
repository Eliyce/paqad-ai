// Vitest JSON reporter parser. Reference: `vitest --reporter=json` emits a
// top-level object with a `testResults` array, each entry having a `name`
// (the test file's absolute path) and an `assertionResults` array of
// `{ status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' }`.
//
// We emit one TestRow per file, summing passing/failing across its assertion
// results. The optional `coverage` field on the top-level Vitest JSON object
// is not consumed here — coverage in vitest projects flows through the lcov
// (or coverage-py-xml) reporter that Vitest's c8 backend produces.

import type { ParsedReport, TestRow } from './types.js';

interface VitestAssertion {
  status?: string;
}

interface VitestTestResult {
  name?: string;
  assertionResults?: VitestAssertion[];
  numPassingTests?: number;
  numFailingTests?: number;
}

interface VitestJsonReport {
  testResults?: VitestTestResult[];
}

export function parseReport(content: string): ParsedReport {
  let parsed: VitestJsonReport;
  try {
    parsed = JSON.parse(content) as VitestJsonReport;
  } catch {
    return { tests: [] };
  }
  const tests: TestRow[] = [];
  for (const result of parsed.testResults ?? []) {
    const file = (result.name ?? '').replace(/\\/g, '/');
    let passing = 0;
    let failing = 0;
    if (Array.isArray(result.assertionResults) && result.assertionResults.length > 0) {
      for (const assertion of result.assertionResults) {
        if (assertion.status === 'passed') passing += 1;
        else if (assertion.status === 'failed') failing += 1;
      }
    } else {
      passing = result.numPassingTests ?? 0;
      failing = result.numFailingTests ?? 0;
    }
    tests.push({ file, passing, failing, total: passing + failing });
  }
  return { tests };
}

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

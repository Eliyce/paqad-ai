// JUnit XML test report parser. The schema is permissive — different runners
// emit slightly different attribute sets. We extract one TestRow per
// <testcase> element. `file=` attribute (Vitest, Jest, pytest) maps to a
// source path when present; otherwise the row is emitted with an empty file
// and the rollup engine folds it into the unattributed bucket.

import type { ParsedReport, TestRow } from './types.js';

const TESTCASE_TAG = /<testcase\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const FILE_ATTR = /\bfile="([^"]+)"/;
const CLASSNAME_ATTR = /\bclassname="([^"]+)"/;
const FAILURE_OR_ERROR = /<(failure|error)\b/;

export function parseReport(content: string): ParsedReport {
  const tests: TestRow[] = [];
  for (const match of content.matchAll(TESTCASE_TAG)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const fileMatch = FILE_ATTR.exec(attrs);
    const classMatch = CLASSNAME_ATTR.exec(attrs);
    const file = (fileMatch?.[1] ?? classMatch?.[1] ?? '').replace(/\\/g, '/');
    const failed = FAILURE_OR_ERROR.test(body);
    tests.push({
      file,
      passing: failed ? 0 : 1,
      failing: failed ? 1 : 0,
      total: 1,
    });
  }
  return { tests };
}

// `go test -json` NDJSON parser. Each line is a JSON event with an `Action`
// field; we count pass/fail events keyed by `Test` name, then bucket each
// test under its `Package` (used as the file key — best-effort since Go
// reports packages rather than files).

import type { ParsedReport, TestRow } from './types.js';

interface GoTestEvent {
  Action?: string;
  Package?: string;
  Test?: string;
}

export function parseReport(content: string): ParsedReport {
  const byPackage = new Map<string, { passing: number; failing: number }>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line[0] !== '{') continue;
    let event: GoTestEvent;
    try {
      event = JSON.parse(line) as GoTestEvent;
    } catch {
      continue;
    }
    if (!event.Test || !event.Package) continue;
    const pkg = event.Package;
    const acc = byPackage.get(pkg) ?? { passing: 0, failing: 0 };
    if (event.Action === 'pass') acc.passing += 1;
    else if (event.Action === 'fail') acc.failing += 1;
    else continue;
    byPackage.set(pkg, acc);
  }
  const tests: TestRow[] = [];
  for (const [pkg, { passing, failing }] of byPackage) {
    tests.push({ file: pkg, passing, failing, total: passing + failing });
  }
  tests.sort((a, b) => a.file.localeCompare(b.file));
  return { tests };
}

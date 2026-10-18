// Pure helpers for scripts/update-shard-timings.mjs (issue #654). No I/O here: the CLI reads
// the vitest JSON report(s) and the current tests/shard-timings.json, and writes the result.
//
// tests/shard-timings.json holds one block per OS (`win32`, `linux`, `darwin`), each mapping a
// root-relative posix test file path to milliseconds. tests/shared/duration-sequencer.ts reads
// it to balance CI shards. A refresh replaces only the current OS's block, with keys sorted so
// the diff stays readable.

import { isAbsolute, relative } from 'node:path';

export const PLATFORMS = ['darwin', 'linux', 'win32'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A path relative to `root` with forward slashes, whatever OS wrote the report. */
export function toRootRelativePosix(root, file) {
  const rel = isAbsolute(file) ? relative(root, file) : file;
  return rel.split('\\').join('/');
}

/**
 * How long one file in a vitest JSON report took, in whole milliseconds: `endTime - startTime`
 * when both are numbers, else the sum of its test durations, else null.
 */
export function fileDurationMs(result) {
  if (typeof result.startTime === 'number' && typeof result.endTime === 'number') {
    return Math.max(0, Math.round(result.endTime - result.startTime));
  }
  if (Array.isArray(result.assertionResults)) {
    const sum = result.assertionResults.reduce(
      (total, test) => total + (typeof test.duration === 'number' ? test.duration : 0),
      0,
    );
    return Math.round(sum);
  }
  return null;
}

/**
 * Per-file durations from one or more vitest JSON reports (`--reporter=json`), keyed by
 * root-relative posix path. A file listed in more than one report keeps the larger time.
 */
export function durationsFromReports(reports, root) {
  const durations = {};
  for (const report of reports) {
    const results =
      isPlainObject(report) && Array.isArray(report.testResults) ? report.testResults : [];
    for (const result of results) {
      if (!isPlainObject(result) || typeof result.name !== 'string') continue;
      const ms = fileDurationMs(result);
      if (ms === null) continue;
      const path = toRootRelativePosix(root, result.name);
      durations[path] = Math.max(durations[path] ?? 0, ms);
    }
  }
  return durations;
}

function sortKeys(object) {
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, object[key]]),
  );
}

/**
 * Replaces `platform`'s block in the existing timings with `durations`, leaving every other
 * OS's block as it was. Keys are sorted at both levels. An existing value that is not an
 * object (missing or broken file) starts from empty.
 */
export function mergeTimings(existing, platform, durations) {
  const base = isPlainObject(existing) ? existing : {};
  return sortKeys({ ...base, [platform]: sortKeys(durations) });
}

/** The file content to write: two-space JSON with a trailing newline. */
export function serializeTimings(timings) {
  return `${JSON.stringify(timings, null, 2)}\n`;
}

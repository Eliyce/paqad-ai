import { isAbsolute, relative } from 'node:path';

export const PLATFORMS = ['darwin', 'linux', 'win32'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toRootRelativePosix(root, file) {
  const rel = isAbsolute(file) ? relative(root, file) : file;
  return rel.split('\\').join('/');
}

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

export function mergeTimings(existing, platform, durations) {
  const base = isPlainObject(existing) ? existing : {};
  return sortKeys({ ...base, [platform]: sortKeys(durations) });
}

export function serializeTimings(timings) {
  return `${JSON.stringify(timings, null, 2)}\n`;
}

export const PLATFORMS = ['darwin', 'linux', 'win32'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DRIVE = /^[A-Za-z]:\//;

function toPosix(path) {
  return path.split('\\').join('/');
}

function isRepoRelative(path) {
  return (
    path.length > 0 && !path.startsWith('/') && !DRIVE.test(path) && !path.split('/').includes('..')
  );
}

function stripPrefix(path, prefix) {
  if (!prefix) return null;
  const base = toPosix(prefix).replace(/\/+$/, '');
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
}

export function repoRelativePath(root, file, { reportRoot, exists = () => true } = {}) {
  const path = toPosix(file);
  if (!path.startsWith('/') && !DRIVE.test(path)) return isRepoRelative(path) ? path : null;
  const stripped = stripPrefix(path, reportRoot) ?? stripPrefix(path, root);
  if (stripped !== null) return isRepoRelative(stripped) ? stripped : null;
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i++) {
    if (segments[i] !== 'tests') continue;
    const candidate = segments.slice(i).join('/');
    if (isRepoRelative(candidate) && exists(candidate)) return candidate;
  }
  return null;
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

export function durationsFromReports(reports, root, options = {}) {
  const durations = {};
  const skipped = [];
  for (const report of reports) {
    const results =
      isPlainObject(report) && Array.isArray(report.testResults) ? report.testResults : [];
    for (const result of results) {
      if (!isPlainObject(result) || typeof result.name !== 'string') continue;
      const ms = fileDurationMs(result);
      if (ms === null) continue;
      const path = repoRelativePath(root, result.name, options);
      if (path === null) {
        skipped.push(result.name);
        continue;
      }
      durations[path] = Math.max(durations[path] ?? 0, ms);
    }
  }
  return { durations, skipped };
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

export function pruneTimings(timings, keep) {
  const pruned = {};
  let dropped = 0;
  for (const [platform, block] of Object.entries(isPlainObject(timings) ? timings : {})) {
    if (!isPlainObject(block)) {
      pruned[platform] = block;
      continue;
    }
    const kept = Object.entries(block).filter(([path]) => keep(path));
    dropped += Object.keys(block).length - kept.length;
    pruned[platform] = Object.fromEntries(kept);
  }
  return { timings: pruned, dropped };
}

export function serializeTimings(timings) {
  return `${JSON.stringify(timings, null, 2)}\n`;
}

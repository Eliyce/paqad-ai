export const SHARD_BUDGET_MS = 270_000;
export const FILE_BUDGET_MS = 90_000;

const SHARD_FIX =
  'Refresh tests/shard-timings.json with scripts/update-shard-timings.mjs, or raise this OS shard count by one in .github/workflows/ci.yml.';
const FILE_FIX =
  'Split it into smaller test files (like tests/unit/onboarding/matrix.g1.test.ts to matrix.g5.test.ts): a single file this slow sets a floor no shard count can get under. Then refresh tests/shard-timings.json with scripts/update-shard-timings.mjs.';

export const MISSING_TIMINGS_MAX_PERCENT = 5;

const TIMINGS_FIX =
  "Refresh this OS block with node scripts/update-shard-timings.mjs --platform <os> --report <file> for each durations-*.json in this run's blob-<os>-node<n>-* artifacts, then commit tests/shard-timings.json.";

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function escapeAnnotation(text) {
  return String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function seconds(ms) {
  return `${Math.round(ms / 1000)}s`;
}

export function summariseShard(label, report, root = '') {
  const results =
    isPlainObject(report) && Array.isArray(report.testResults) ? report.testResults : [];
  const prefix = root ? `${root.split('\\').join('/').replace(/\/$/, '')}/` : '';
  const files = [];
  let start =
    isPlainObject(report) && typeof report.startTime === 'number' ? report.startTime : Infinity;
  let end = -Infinity;
  for (const result of results) {
    if (!isPlainObject(result) || typeof result.name !== 'string') continue;
    if (typeof result.startTime !== 'number' || typeof result.endTime !== 'number') continue;
    let path = result.name.split('\\').join('/');
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    files.push({ path, ms: Math.max(0, result.endTime - result.startTime) });
    start = Math.min(start, result.startTime);
    end = Math.max(end, result.endTime);
  }
  const wallMs = files.length > 0 ? Math.max(0, end - start) : 0;
  return { label, wallMs, files };
}

export function budgetWarnings(shards, os, budgets = {}) {
  const shardBudget = budgets.shardMs ?? SHARD_BUDGET_MS;
  const fileBudget = budgets.fileMs ?? FILE_BUDGET_MS;
  const warnings = [];
  const slowest = shards.reduce(
    (worst, shard) => (worst && worst.wallMs >= shard.wallMs ? worst : shard),
    null,
  );
  if (slowest && slowest.wallMs > shardBudget) {
    warnings.push(
      `::warning title=Shard over budget::${escapeAnnotation(
        `Shard ${slowest.label} on ${os} took ${seconds(slowest.wallMs)} of tests, over the ${seconds(shardBudget)} budget. ${SHARD_FIX}`,
      )}`,
    );
  }
  const slowFiles = shards
    .flatMap((shard) => shard.files.map((file) => ({ ...file, shard: shard.label })))
    .filter((file) => file.ms > fileBudget)
    .sort((a, b) => b.ms - a.ms || (a.path < b.path ? -1 : 1));
  for (const file of slowFiles) {
    warnings.push(
      `::warning file=${escapeAnnotation(file.path)},title=Test file over budget::${escapeAnnotation(
        `${file.path} took ${seconds(file.ms)} on ${os} (shard ${file.shard}), over the ${seconds(fileBudget)} budget for one file. ${FILE_FIX}`,
      )}`,
    );
  }
  return warnings;
}

export function timingCoverage(shards, timings, platform) {
  const block = isPlainObject(timings) && isPlainObject(timings[platform]) ? timings[platform] : {};
  const files = [
    ...new Set(shards.flatMap((shard) => shard.files.map((file) => file.path))),
  ].sort();
  const missing = files.filter((path) => !Object.hasOwn(block, path));
  return { platform, total: files.length, missing };
}

export function timingCoverageError(coverage, os, maxPercent = MISSING_TIMINGS_MAX_PERCENT) {
  const { platform, total, missing } = coverage;
  if (total === 0 || missing.length * 100 <= total * maxPercent) return null;
  const shown = missing.slice(0, 10).join(', ');
  const more = missing.length > 10 ? ` and ${missing.length - 10} more` : '';
  return `::error title=Shard timings missing::${escapeAnnotation(
    `${missing.length} of ${total} test files in the ${os} shard reports have no ${platform} timing in tests/shard-timings.json, over the ${maxPercent} percent limit: ${shown}${more}. ${TIMINGS_FIX}`,
  )}`;
}

export function timingCoverageSummary(coverage, os) {
  return `Timings on ${os}: ${coverage.total - coverage.missing.length} of ${coverage.total} test files have a ${coverage.platform} timing.`;
}

export function budgetSummary(shards, os) {
  if (shards.length === 0) return [`No shard durations found for ${os}.`];
  return [...shards]
    .sort((a, b) => b.wallMs - a.wallMs || (a.label < b.label ? -1 : 1))
    .map(
      (shard) =>
        `Shard ${shard.label} on ${os}: ${seconds(shard.wallMs)} of tests over ${shard.files.length} files.`,
    );
}

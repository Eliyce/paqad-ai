// Pure helpers for scripts/check-shard-budget.mjs (issue #654). No I/O here.
//
// Each CI test shard writes a vitest JSON report of its own files next to its blob report. After
// an OS's shards are merged, the budget check reads those reports and warns, without failing the
// build, when the shards have drifted: the slowest shard ran over 270s, or one test file ran over
// 90s. That is what keeps the sharded run inside its time target as tests are added.

export const SHARD_BUDGET_MS = 270_000;
export const FILE_BUDGET_MS = 90_000;

const SHARD_FIX =
  'Refresh tests/shard-timings.json with scripts/update-shard-timings.mjs, or raise this OS shard count by one in .github/workflows/ci.yml.';
const FILE_FIX =
  'Split it into smaller test files (like tests/unit/onboarding/matrix.g1.test.ts to matrix.g5.test.ts): a single file this slow sets a floor no shard count can get under. Then refresh tests/shard-timings.json with scripts/update-shard-timings.mjs.';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Escapes a GitHub workflow command value (`%`, CR and LF). */
export function escapeAnnotation(text) {
  return String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function seconds(ms) {
  return `${Math.round(ms / 1000)}s`;
}

/**
 * Summarises one shard's vitest JSON report: its wall time (from the run start to the last file
 * finishing) and each file's own time. Paths are made root-relative with forward slashes when
 * they start with `root`.
 */
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

/**
 * The budget warnings for one OS's shards, as GitHub `::warning::` lines. Empty when every
 * shard and every file is inside its budget.
 */
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

/** One plain line per shard, slowest first, for the job log. */
export function budgetSummary(shards, os) {
  if (shards.length === 0) return [`No shard durations found for ${os}.`];
  return [...shards]
    .sort((a, b) => b.wallMs - a.wallMs || (a.label < b.label ? -1 : 1))
    .map(
      (shard) =>
        `Shard ${shard.label} on ${os}: ${seconds(shard.wallMs)} of tests over ${shard.files.length} files.`,
    );
}

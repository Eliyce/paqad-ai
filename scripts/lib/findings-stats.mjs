// Deterministic-findings stats over the rule-evidence ledger (issue #285, headline b).
// Pure helpers only — no I/O. The runnable CLI (rule-findings-stats.mjs) reads the
// ledger via readProjectEvents and pipes the rows through bucketFindings.
//
// Honesty note baked into the metric: the rule runner appends a row only on a FRESH
// run (cache hits return early), and each row's `counts.deterministic` is a snapshot
// of the findings PRESENT at that run, not incremental "new catches". Naively summing
// rows double-counts a persistent finding across runs. So the metric is defined as the
// per-fresh-run snapshot, reported per ISO week as median and max — never a running sum.

/** Ledger doc type the rule runner records findings under (mirrors RULE_EVIDENCE_DOC_TYPE). */
export const RULE_EVIDENCE_DOC_TYPE = 'rule-evidence';

/** The metric definition, embedded in every rendered report so the number is never bare. */
export const METRIC_DEFINITION =
  'Deterministic findings PRESENT per fresh rule-script run (a snapshot, not a running ' +
  'sum — cache hits append no row, and each row counts findings present at that run). ' +
  'Bucketed by ISO-8601 week; reported as weekly median and max. Source: the rule-evidence ' +
  'ledger read via readProjectEvents.';

/**
 * ISO-8601 week label (`YYYY-Www`) for an ISO timestamp. Uses the Thursday-of-week rule
 * so week 1 is the week containing the year's first Thursday. Pure and UTC-based.
 *
 * @param {string} isoTs
 * @returns {string｜null} the week label, or null when the timestamp is unparseable
 */
export function isoWeek(isoTs) {
  const date = new Date(isoTs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // Shift to the Thursday of the current week (ISO weeks are Monday-based).
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Median of a numeric array (0 for empty). Pure. */
function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Bucket rule-findings rows by ISO week. Only `kind: 'findings'` rows with a numeric
 * `counts.deterministic` and a parseable `ts` are counted. Pure.
 *
 * @param {{kind?: string, ts?: string, counts?: {deterministic?: number}}[]} rows
 * @returns {{weeks: {week: string, runs: number, median: number, max: number}[], total_runs: number, definition: string}}
 */
export function bucketFindings(rows) {
  const byWeek = new Map();
  for (const row of rows) {
    if (row.kind !== 'findings') {
      continue;
    }
    const deterministic = row.counts?.deterministic;
    if (typeof deterministic !== 'number' || Number.isNaN(deterministic)) {
      continue;
    }
    const week = typeof row.ts === 'string' ? isoWeek(row.ts) : null;
    if (week === null) {
      continue;
    }
    const bucket = byWeek.get(week);
    if (bucket) {
      bucket.push(deterministic);
    } else {
      byWeek.set(week, [deterministic]);
    }
  }

  const weeks = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, values]) => ({
      week,
      runs: values.length,
      median: median(values),
      max: Math.max(...values),
    }));

  return {
    weeks,
    total_runs: weeks.reduce((acc, w) => acc + w.runs, 0),
    definition: METRIC_DEFINITION,
  };
}

/**
 * Build the machine-readable findings report.
 *
 * @param {ReturnType<typeof bucketFindings>} bucketed
 * @param {{project: string, hostTiers: string, date: string}} meta
 */
export function buildFindingsReport(bucketed, meta) {
  return {
    project: meta.project,
    date: meta.date,
    host_tiers: meta.hostTiers,
    definition: bucketed.definition,
    total_runs: bucketed.total_runs,
    weeks: bucketed.weeks,
  };
}

/**
 * Render the findings stats as Markdown. Returns a "no data" note (not an empty table)
 * when the ledger held no findings rows.
 *
 * @param {ReturnType<typeof bucketFindings>} bucketed
 * @param {{project: string, hostTiers: string, date: string}} meta
 */
export function renderFindingsMarkdown(bucketed, meta) {
  const lines = [];
  lines.push(`# Deterministic findings — ${meta.project}`);
  lines.push('');
  lines.push(`Measured ${meta.date}. Ledger fed by: ${meta.hostTiers}.`);
  lines.push('');
  lines.push(`> ${bucketed.definition}`);
  lines.push('');
  if (bucketed.weeks.length === 0) {
    lines.push('No data: the rule-evidence ledger holds no findings rows for this project yet.');
    return lines.join('\n');
  }
  lines.push('| ISO week | Fresh runs | Median deterministic | Max deterministic |');
  lines.push('| --- | --- | --- | --- |');
  for (const w of bucketed.weeks) {
    lines.push(`| ${w.week} | ${w.runs} | ${w.median} | ${w.max} |`);
  }
  lines.push('');
  lines.push(`**Total fresh runs observed:** ${bucketed.total_runs}.`);
  return lines.join('\n');
}

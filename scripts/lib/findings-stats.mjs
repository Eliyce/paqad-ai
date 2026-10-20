export const METRIC_DEFINITION =
  'Deterministic findings PRESENT per fresh rule-script run (a snapshot, not a running ' +
  'sum — cache hits append no row, and each row counts findings present at that run). ' +
  'Bucketed by ISO-8601 week; reported as weekly median and max. Source: the per-feature ' +
  'rule-run.jsonl bundle files.';

export function isoWeek(isoTs) {
  const date = new Date(isoTs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

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
    const at = typeof row.recorded_at === 'string' ? row.recorded_at : row.ts;
    const week = typeof at === 'string' ? isoWeek(at) : null;
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

export function renderFindingsMarkdown(bucketed, meta) {
  const lines = [];
  lines.push(`# Deterministic findings — ${meta.project}`);
  lines.push('');
  lines.push(`Measured ${meta.date}. Ledger fed by: ${meta.hostTiers}.`);
  lines.push('');
  lines.push(`> ${bucketed.definition}`);
  lines.push('');
  if (bucketed.weeks.length === 0) {
    lines.push(
      'No data: no per-feature rule-run bundle holds a findings row for this project yet.',
    );
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

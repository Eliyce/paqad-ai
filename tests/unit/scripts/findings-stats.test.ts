import { describe, expect, it } from 'vitest';

import {
  bucketFindings,
  buildFindingsReport,
  isoWeek,
  METRIC_DEFINITION,
  renderFindingsMarkdown,
  RULE_EVIDENCE_DOC_TYPE,
  // @ts-expect-error -- pure JS helper shared with the runnable rule-findings-stats.mjs script
} from '../../../scripts/lib/findings-stats.mjs';

describe('RULE_EVIDENCE_DOC_TYPE', () => {
  it('matches the ledger doc type the rule runner records under', () => {
    expect(RULE_EVIDENCE_DOC_TYPE).toBe('rule-evidence');
  });
});

describe('isoWeek', () => {
  it('labels a mid-week date with its ISO week', () => {
    // 2026-07-03 is a Friday in ISO week 27.
    expect(isoWeek('2026-07-03T10:00:00.000Z')).toBe('2026-W27');
  });

  it('returns null for an unparseable timestamp', () => {
    expect(isoWeek('not-a-date')).toBeNull();
  });

  it('keeps a Sunday in the week that started the previous Monday', () => {
    // 2026-01-04 is a Sunday; ISO week 1 of 2026.
    expect(isoWeek('2026-01-04T23:59:00.000Z')).toBe('2026-W01');
  });
});

describe('bucketFindings', () => {
  const rows = [
    { kind: 'findings', ts: '2026-07-01T09:00:00.000Z', counts: { deterministic: 4 } },
    { kind: 'findings', ts: '2026-07-02T09:00:00.000Z', counts: { deterministic: 8 } },
    { kind: 'findings', ts: '2026-07-03T09:00:00.000Z', counts: { deterministic: 6 } },
    // Different week.
    { kind: 'findings', ts: '2026-07-10T09:00:00.000Z', counts: { deterministic: 2 } },
    // Non-findings rows and malformed rows are ignored.
    { kind: 'drift', ts: '2026-07-03T09:00:00.000Z', counts: { RS_1: 1 } },
    { kind: 'findings', ts: '2026-07-03T09:00:00.000Z', counts: {} },
    { kind: 'findings', ts: 'bad-ts', counts: { deterministic: 99 } },
  ];

  it('buckets deterministic counts by ISO week with median and max', () => {
    const { weeks } = bucketFindings(rows);
    const w27 = weeks.find((w: { week: string }) => w.week === '2026-W27');
    expect(w27).toMatchObject({ week: '2026-W27', runs: 3, median: 6, max: 8 });
  });

  it('counts only well-formed findings rows toward total runs', () => {
    const { total_runs } = bucketFindings(rows);
    // 3 in W27 + 1 in W28 = 4; drift, empty-counts, and bad-ts rows excluded.
    expect(total_runs).toBe(4);
  });

  it('orders weeks chronologically', () => {
    const { weeks } = bucketFindings(rows);
    expect(weeks.map((w: { week: string }) => w.week)).toEqual(['2026-W27', '2026-W28']);
  });

  it('returns an empty result and the definition when there are no rows', () => {
    const result = bucketFindings([]);
    expect(result.weeks).toEqual([]);
    expect(result.total_runs).toBe(0);
    expect(result.definition).toBe(METRIC_DEFINITION);
  });
});

describe('renderFindingsMarkdown', () => {
  const meta = { project: '/tmp/p', hostTiers: 'live-hook host (claude-code)', date: '2026-07-03' };

  it('prints a "no data" note instead of an empty table', () => {
    const md = renderFindingsMarkdown(bucketFindings([]), meta);
    expect(md).toContain('No data');
    expect(md).not.toContain('| ISO week |');
  });

  it('embeds the metric definition next to the numbers', () => {
    const rows = [
      { kind: 'findings', ts: '2026-07-03T09:00:00.000Z', counts: { deterministic: 5 } },
    ];
    const md = renderFindingsMarkdown(bucketFindings(rows), meta);
    expect(md).toContain('snapshot, not a running sum');
    expect(md).toContain('| ISO week | Fresh runs | Median deterministic | Max deterministic |');
  });
});

describe('buildFindingsReport', () => {
  it('carries project, host tiers, definition, and weekly buckets', () => {
    const rows = [
      { kind: 'findings', ts: '2026-07-03T09:00:00.000Z', counts: { deterministic: 5 } },
    ];
    const report = buildFindingsReport(bucketFindings(rows), {
      project: '/tmp/p',
      hostTiers: 'live-hook host (claude-code)',
      date: '2026-07-03',
    });
    expect(report).toMatchObject({
      project: '/tmp/p',
      host_tiers: 'live-hook host (claude-code)',
      total_runs: 1,
    });
    expect(report.definition).toBe(METRIC_DEFINITION);
    expect(report.weeks).toHaveLength(1);
  });
});

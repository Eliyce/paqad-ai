// Dashboard collector for the change-shape metrics trend (issue #362).
//
// Reads the last 20 change-metrics rows off the project ledger and turns them into two
// sparkline-ready series (duplication on new code, cross-file reuse rate) plus a band scored
// on the latest duplication reading — SonarQube's 3% precedent for the green ceiling, 10% for
// the amber/red boundary. `unknown` until a change has been measured.

import { readChangeMetricsRows } from '@/change-metrics/index.js';

import type { AttentionItem, ScoreBand, SectionData } from '../types.js';

/** How many recent changes the trend renders. */
const WINDOW = 20;

const HELPER = {
  what: 'Change shape tracks two deterministic, zero-token numbers per change: the % of new code that near-duplicates existing code, and cross-file reuse calls per 100 changed lines.',
  goodLooksLike: 'Duplication trending toward 0% and reuse holding or rising over time.',
} as const;

/** A numeric field on a ledger row, or null when it was recorded as n/a / is missing. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Band + representative score from the latest numeric duplication reading. */
function bandForDuplication(latestDup: number | null): { band: ScoreBand; score: number | null } {
  if (latestDup === null) {
    return { band: 'unknown', score: null };
  }
  if (latestDup <= 3) {
    return { band: 'green', score: 95 };
  }
  if (latestDup <= 10) {
    return { band: 'amber', score: 65 };
  }
  return { band: 'red', score: 30 };
}

export function collectChangeMetrics(projectRoot: string): {
  section: SectionData;
  attention: AttentionItem[];
} {
  const rows = readChangeMetricsRows(projectRoot, WINDOW);

  if (rows.length === 0) {
    return {
      section: {
        id: 'change-metrics',
        title: 'Change Shape',
        band: 'unknown',
        score: null,
        summary: 'No changes measured yet',
        metrics: [{ label: 'changes', value: '—' }],
        helper: HELPER,
      },
      attention: [],
    };
  }

  const dupSeries = rows.map((row) => numberOrNull(row.dup_new_pct));
  const reuseSeries = rows.map((row) => numberOrNull(row.reuse_rate));

  // Band on the most recent change that actually produced a duplication reading.
  const latestDup = [...dupSeries].reverse().find((value) => value !== null) ?? null;
  const latestReuse = [...reuseSeries].reverse().find((value) => value !== null) ?? null;
  const { band, score } = bandForDuplication(latestDup);

  const dupText = latestDup === null ? 'n/a' : `${latestDup}%`;
  const reuseText = latestReuse === null ? 'n/a' : latestReuse.toFixed(1);
  const summary = `dup ${dupText} · reuse ${reuseText}/100 · ${rows.length} changes`;

  const attention: AttentionItem[] = [];
  if (band === 'red') {
    attention.push({
      sectionId: 'change-metrics',
      message: `New code is duplicating existing code (${dupText}) — prefer reusing or extending helpers.`,
      severity: 'warn',
    });
  }

  return {
    section: {
      id: 'change-metrics',
      title: 'Change Shape',
      band,
      score,
      summary: summary.slice(0, 60),
      metrics: [
        { label: 'duplication', value: dupText },
        { label: 'reuse /100', value: reuseText },
        { label: 'changes', value: String(rows.length) },
      ],
      helper: HELPER,
      details: {
        window: WINDOW,
        samples: rows.length,
        dup_series: dupSeries,
        reuse_series: reuseSeries,
        latest_dup_new_pct: latestDup,
        latest_reuse_rate: latestReuse,
      },
    },
    attention,
  };
}

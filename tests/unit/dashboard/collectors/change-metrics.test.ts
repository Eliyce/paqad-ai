import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectChangeMetrics } from '@/dashboard/collectors/change-metrics.js';
import type { ChangeMetrics } from '@/change-metrics/index.js';
import { appendChangeMetrics } from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-dash-metrics-'));
  // Issue #468 Phase B — the collector reads the per-feature bundle change-metrics rows,
  // so every test seeds an active feature to append into.
  openFeatureChange(r, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
  return r;
}

function metrics(dup: number | null, reuse: number | null): ChangeMetrics {
  return {
    dup_new_pct: dup,
    reuse_rate: reuse,
    meaningful_changed_lines: 100,
    inputs: {
      flagged_lines: 0,
      reuse_calls: 0,
      duplication_report_present: true,
      index_present: true,
    },
  };
}

/** Append a change-metrics row into the active bundle with a controlled, increasing ts so
 *  the ts-sorted window is deterministic. */
let seq = 0;
function record(r: string, m: ChangeMetrics): void {
  seq += 1;
  const ts = new Date(Date.UTC(2026, 7, 12, 0, 0, seq));
  appendChangeMetrics(r, 'ses_1', m, () => ts);
}

describe('collectChangeMetrics', () => {
  it('is unknown until a change has been measured', () => {
    const { section, attention } = collectChangeMetrics(root());
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(attention).toEqual([]);
  });

  it('builds both series and bands green when the latest duplication is low', () => {
    const r = root();
    record(r, metrics(1, 3));
    record(r, metrics(2, 4.2));

    const { section, attention } = collectChangeMetrics(r);
    expect(section.band).toBe('green');
    expect(section.details?.dup_series).toEqual([1, 2]);
    expect(section.details?.reuse_series).toEqual([3, 4.2]);
    expect(section.summary).toContain('dup 2%');
    expect(section.summary).toContain('reuse 4.2/100');
    expect(attention).toEqual([]);
  });

  it('bands amber in the 3–10% range', () => {
    const r = root();
    record(r, metrics(7, 1));
    expect(collectChangeMetrics(r).section.band).toBe('amber');
  });

  it('bands red above 10% and raises an attention item', () => {
    const r = root();
    record(r, metrics(15, 0));
    const { section, attention } = collectChangeMetrics(r);
    expect(section.band).toBe('red');
    expect(attention).toHaveLength(1);
    expect(attention[0]!.message).toContain('duplicating');
  });

  it('bands unknown and renders n/a when the latest readings are all n/a', () => {
    const r = root();
    record(r, metrics(null, null));
    const { section } = collectChangeMetrics(r);
    expect(section.band).toBe('unknown');
    expect(section.summary).toContain('dup n/a');
    expect(section.summary).toContain('reuse n/a');
  });
});

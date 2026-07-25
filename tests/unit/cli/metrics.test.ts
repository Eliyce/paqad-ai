import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMetricsCommand, trendOf } from '@/cli/commands/metrics.js';
import { recordChangeMetrics } from '@/change-metrics/index.js';
import type { ChangeMetrics } from '@/change-metrics/index.js';

function root(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-cli-metrics-'));
}

function metrics(dup: number | null, reuse: number | null, lines = 100): ChangeMetrics {
  return {
    dup_new_pct: dup,
    reuse_rate: reuse,
    meaningful_changed_lines: lines,
    inputs: { flagged_lines: 0, reuse_calls: 0, duplication_report_present: true, index_present: true },
  };
}

async function run(args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line?: unknown) => err.push(String(line)));
  await createMetricsCommand().parseAsync(args, { from: 'user' });
  return { out, err };
}

describe('trendOf', () => {
  it('is flat with fewer than two numeric points', () => {
    expect(trendOf([null, 5, null])).toBe('flat');
  });
  it('detects a rising then falling series', () => {
    expect(trendOf([1, 1, 9, 9])).toBe('rising');
    expect(trendOf([9, 9, 1, 1])).toBe('falling');
  });
});

describe('paqad-ai metrics report', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the trend sentence and a table for recorded changes', async () => {
    const r = root();
    recordChangeMetrics(r, metrics(1, 3));
    recordChangeMetrics(r, metrics(3, 4.2));

    const { out } = await run(['report', '--project-root', r]);
    const text = out.join('\n');
    expect(text).toContain('change shape (last 2 changes)');
    expect(text).toContain('of new code duplicated existing code');
    expect(text).toContain('industry drift: rising');
    expect(text).toContain('| duplication | reuse /100 |');
  });

  it('emits JSON with --json', async () => {
    const r = root();
    recordChangeMetrics(r, metrics(2, 4.2));

    const { out } = await run(['report', '--project-root', r, '--json']);
    const parsed = JSON.parse(out.join('\n')) as { count: number; rows: unknown[] };
    expect(parsed.count).toBe(1);
    expect(parsed.rows).toHaveLength(1);
  });

  it('says so when nothing has been measured', async () => {
    const { out } = await run(['report', '--project-root', root()]);
    expect(out.join('\n')).toContain('no changes measured yet');
  });

  it('refuses when paqad is disabled for the project', async () => {
    const r = root();
    mkdirSync(join(r, '.paqad/configs'), { recursive: true });
    writeFileSync(join(r, '.paqad/configs/.config.app'), 'paqad_enable=false\n');

    const { out, err } = await run(['report', '--project-root', r]);
    expect(err.join('\n')).toContain('paqad is disabled');
    expect(out).toEqual([]);
  });
});

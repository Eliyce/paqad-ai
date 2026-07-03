import { describe, expect, it } from 'vitest';

import {
  aggregateFootprint,
  buildFootprintReport,
  formatPercent,
  renderFootprintMarkdown,
  RESIDENT_AREAS,
  // @ts-expect-error -- pure JS helper shared with the runnable measure-footprint.mjs script
} from '../../../scripts/lib/footprint.mjs';

/** char/4, the same fallback tokenizer-cache uses; deterministic for assertions. */
const heuristic = (text: string): number => Math.ceil(text.length / 4);

/** A representative record set: entry, manifest, full tree (on-demand), task-loaded, extras. */
const RECORDS = [
  { area: 'entry', kind: 'entry', path: 'CLAUDE.md', text: 'x'.repeat(400) },
  {
    area: 'rules-manifest',
    kind: 'resident',
    path: '.paqad/context/session-context.md',
    text: 'm'.repeat(2000),
  },
  {
    area: 'rules-loaded',
    kind: 'task-loaded',
    path: '.paqad/context/session-context.md',
    text: 'l'.repeat(3000),
  },
  {
    area: 'rules',
    kind: 'on-demand',
    path: 'docs/instructions/rules/a.md',
    text: 'r'.repeat(8000),
  },
  {
    area: 'stack',
    kind: 'resident',
    path: 'docs/instructions/stack/overview.md',
    text: 's'.repeat(1000),
  },
  {
    area: 'registries',
    kind: 'on-demand',
    path: 'docs/instructions/registries/x.md',
    text: 'g'.repeat(1200),
  },
];

describe('RESIDENT_AREAS', () => {
  it('names exactly the bootstrap session-start areas', () => {
    expect(RESIDENT_AREAS).toEqual(['rules', 'stack', 'design-system', 'workflows']);
  });
});

describe('aggregateFootprint', () => {
  it('sums resident as entry + resident-kind areas, excluding on-demand and task-loaded', () => {
    const { totals } = aggregateFootprint(RECORDS, heuristic);
    // entry(400) + manifest(2000) + stack(1000) = 3400 chars
    expect(totals.resident.chars).toBe(3400);
    expect(totals.resident.tokens).toBe(heuristic('x'.repeat(3400)));
  });

  it('reports task-loaded separately from resident and on-demand', () => {
    const { totals } = aggregateFootprint(RECORDS, heuristic);
    expect(totals.taskLoaded.chars).toBe(3000);
    expect(totals.onDemand.chars).toBe(8000 + 1200);
  });

  it('computes full by swapping the manifest floor for the full rule tree', () => {
    const { totals } = aggregateFootprint(RECORDS, heuristic);
    // full = resident(3400) - manifest(2000) + fullRules(8000) = 9400
    expect(totals.full.chars).toBe(9400);
  });

  it('derives a positive reduction when the full tree dwarfs the manifest', () => {
    const { reduction } = aggregateFootprint(RECORDS, heuristic);
    // (9400 - 3400) / 9400
    expect(reduction.chars).toBeCloseTo(6000 / 9400, 5);
    expect(reduction.chars).toBeGreaterThan(0);
  });

  it('yields zero reduction when there is no lean slice (rules already resident)', () => {
    const noSlice = [
      { area: 'entry', kind: 'entry', path: 'CLAUDE.md', text: 'x'.repeat(400) },
      {
        area: 'rules',
        kind: 'resident',
        path: 'docs/instructions/rules/a.md',
        text: 'r'.repeat(8000),
      },
    ];
    const { totals, reduction } = aggregateFootprint(noSlice, heuristic);
    expect(totals.full.chars).toBe(totals.resident.chars);
    expect(reduction.chars).toBe(0);
  });

  it('sorts areas by descending chars', () => {
    const { areas } = aggregateFootprint(RECORDS, heuristic);
    const chars = areas.map((a: { chars: number }) => a.chars);
    expect(chars).toEqual([...chars].sort((a, b) => b - a));
  });
});

describe('formatPercent', () => {
  it('rounds a ratio to a whole-percent string', () => {
    expect(formatPercent(0.638)).toBe('64%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('buildFootprintReport', () => {
  it('carries project, commit, date, tokenizer version, and totals', () => {
    const aggregate = aggregateFootprint(RECORDS, heuristic);
    const report = buildFootprintReport(aggregate, {
      project: '/tmp/p',
      commit: 'abc1234',
      tokenizerVersion: 'heuristic',
      date: '2026-07-03',
    });
    expect(report).toMatchObject({
      project: '/tmp/p',
      commit: 'abc1234',
      date: '2026-07-03',
      tokenizer_version: 'heuristic',
    });
    expect(report.resident.chars).toBe(3400);
    expect(report.task_loaded.chars).toBe(3000);
  });
});

describe('renderFootprintMarkdown', () => {
  it('renders a per-area table plus resident/full/reduction lines', () => {
    const aggregate = aggregateFootprint(RECORDS, heuristic);
    const md = renderFootprintMarkdown(aggregate, {
      project: '/tmp/p',
      commit: 'abc1234',
      tokenizerVersion: 'Xenova/gpt2',
      date: '2026-07-03',
    });
    expect(md).toContain('| Area | Load | Files | Chars | Tokens |');
    expect(md).toContain('Resident at session start (manifest floor):');
    expect(md).toContain('Full instruction load (lean rules off):');
    expect(md).toContain('Resident vs full reduction:');
    expect(md).toContain('Task-loaded rule text (varies per session):');
  });

  it('labels the heuristic tokenizer inline when it was used', () => {
    const aggregate = aggregateFootprint(RECORDS, heuristic);
    const md = renderFootprintMarkdown(aggregate, {
      project: '/tmp/p',
      commit: 'abc1234',
      tokenizerVersion: 'heuristic',
      date: '2026-07-03',
    });
    expect(md).toContain('char/4 heuristic');
  });
});

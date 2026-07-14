import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthReportIndex } from '@/core/types/codebase-health.js';
import { collectCodebaseHealth } from '@/dashboard/collectors/codebase-health.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-dash-'));
}

function writeSidecar(root: string, name: string, report: Partial<HealthReportIndex>): void {
  const dir = join(root, PATHS.HEALTH_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(report));
}

const NOW = Date.parse('2026-07-14T00:00:00.000Z');

describe('collectCodebaseHealth', () => {
  it('is an unknown, empty section when there are no runs', () => {
    const { section, attention } = collectCodebaseHealth(repo(), NOW);
    expect(section.band).toBe('unknown');
    expect(section.summary).toContain('No health runs yet');
    expect(attention).toEqual([]);
  });

  it('handles an unreadable latest sidecar', () => {
    const root = repo();
    const dir = join(root, PATHS.HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-07-13-00-00-00.json'), 'not json');
    const { section } = collectCodebaseHealth(root, NOW);
    expect(section.summary).toContain('unreadable');
  });

  it('summarises the latest run and raises attention for open findings', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00.json', {
      report_id: 'HEALTH-2026-07-13-00-00-00',
      generated_at: '2026-07-13T00:00:00.000Z',
      findings: [{ id: 'HL-1', status: 'open' } as never, { id: 'HL-2', status: 'open' } as never],
      blocked_checks: [{ check: 'duplication', reason: 'x', install_hint: 'y' }],
    });
    const { section, attention } = collectCodebaseHealth(root, NOW);
    expect(section.id).toBe('codebase-health');
    expect(section.metrics.find((m) => m.label === 'open findings')?.value).toBe('2');
    expect(section.metrics.find((m) => m.label === 'blocked')?.value).toBe('1');
    expect(attention).toHaveLength(1);
    expect(attention[0]!.severity).toBe('warn');
  });

  it('degrades to an em-dash age when generated_at is unparseable', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00.json', {
      report_id: 'HEALTH-x',
      generated_at: 'not-a-date',
      findings: [],
      blocked_checks: [],
    });
    const { section } = collectCodebaseHealth(root, NOW);
    expect(section.metrics.find((m) => m.label === 'latest')?.value).toBe('—');
  });

  it('marks critical attention when 5+ findings are open, and excludes retest sidecars', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00-retest-2026-07-14-00-00-00.json', {
      report_id: 'RETEST',
      generated_at: '2026-07-14T00:00:00.000Z',
      findings: [],
      blocked_checks: [],
    });
    writeSidecar(root, '2026-07-12-00-00-00.json', {
      report_id: 'HEALTH-2026-07-12-00-00-00',
      generated_at: '2026-07-12T00:00:00.000Z',
      findings: Array.from({ length: 5 }, (_, i) => ({ id: `HL-${i}`, status: 'open' }) as never),
      blocked_checks: [],
    });
    const { section, attention } = collectCodebaseHealth(root, NOW);
    // The retest sidecar is excluded, so runs === 1.
    expect(section.metrics.find((m) => m.label === 'runs')?.value).toBe('1');
    expect(attention[0]!.severity).toBe('critical');
  });
});

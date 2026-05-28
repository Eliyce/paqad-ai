import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { rollupModuleHealth } from '@/module-health/rollup.js';

describe('module-health/rollup', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rollup-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMap(modules: { slug: string; sources: string[] }[]): void {
    const yaml = [
      'modules:',
      ...modules.flatMap((m) => [
        `  - slug: ${m.slug}`,
        `    name: ${m.slug}`,
        '    sources:',
        ...m.sources.map((s) => `      - ${s}`),
      ]),
    ].join('\n');
    writeFileSync(join(root, PATHS.MODULE_MAP), yaml + '\n', 'utf8');
  }

  it('hard-fails with module_health_unknown when moduleHealth is null', async () => {
    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: null,
    });
    expect(report.blocked).toBe('module_health_unknown');
    expect(report.modules).toEqual([]);
  });

  it('rolls up lcov coverage onto module slugs and writes profiles', async () => {
    writeMap([
      { slug: 'cli-refresh', sources: ['src/cli/commands/refresh.ts'] },
      { slug: 'module-map-engine', sources: ['src/module-map/**'] },
    ]);
    const lcovPath = join(root, 'coverage/lcov.info');
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(
      lcovPath,
      [
        'SF:src/cli/commands/refresh.ts',
        'LF:10',
        'LH:8',
        'end_of_record',
        'SF:src/module-map/reconciler.ts',
        'LF:100',
        'LH:75',
        'end_of_record',
        'SF:src/unmapped/orphan.ts',
        'LF:5',
        'LH:5',
        'end_of_record',
      ].join('\n'),
      'utf8',
    );

    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'lcov',
        coverage_path: 'coverage/lcov.info',
        public_api_extractor: null,
      },
      now: () => '2026-05-28T00:00:00.000Z',
    });

    expect(report.blocked).toBeNull();
    expect(report.modules.map((m) => m.slug).sort()).toEqual(['cli-refresh', 'module-map-engine']);

    // AC #36 — when writeProfiles is true (default), the engine appends a
    // module.health.rolled-up event to .paqad/module-map/events.jsonl.
    const { readModuleMapEvents } = await import('@/module-decisions/events.js');
    const events = readModuleMapEvents(root);
    expect(events.some((e) => e.type === 'module.health.rolled-up')).toBe(true);

    const refresh = report.modules.find((m) => m.slug === 'cli-refresh');
    expect(refresh?.profile.metrics.coverage_pct).toBe(80);
    expect(refresh?.profile.blocked_metrics).toContain(
      'contract_stability:no_public_api_extractor',
    );
    expect(refresh?.profile.blocked_metrics).toContain('tests:not_configured');

    const mapEng = report.modules.find((m) => m.slug === 'module-map-engine');
    expect(mapEng?.profile.metrics.coverage_pct).toBe(75);

    // unattributed file surfaced
    expect(report.unattributed_files).toContain('src/unmapped/orphan.ts');

    // profile written
    const onDisk = JSON.parse(
      readFileSync(join(root, PATHS.PLANNING_MODULE_HEALTH_DIR, 'cli-refresh.json'), 'utf8'),
    );
    expect(onDisk.module).toBe('cli-refresh');
    expect(onDisk.metrics.coverage_pct).toBe(80);
    expect(onDisk.evidence.rollup.coverage_format).toBe('lcov');
  });

  it('marks every metric blocked when neither coverage nor tests are configured', async () => {
    writeMap([{ slug: 'mod-a', sources: ['src/a/**'] }]);
    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        public_api_extractor: null,
      },
      writeProfiles: false,
      now: () => '2026-05-28T00:00:00.000Z',
    });
    const m = report.modules[0]!;
    expect(m.profile.metrics.coverage_pct).toBeNull();
    expect(m.profile.metrics.tests_total).toBeNull();
    expect(m.profile.metrics.contract_stability).toBeNull();
    const blocked = m.profile.blocked_metrics ?? [];
    expect(blocked).toContain('coverage:not_configured');
    expect(blocked).toContain('tests:not_configured');
    expect(blocked).toContain('contract_stability:no_public_api_extractor');
  });

  it('records report_missing when coverage_path points at a missing file', async () => {
    writeMap([{ slug: 'mod-a', sources: ['src/a/**'] }]);
    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'lcov',
        coverage_path: 'coverage/missing.info',
        public_api_extractor: null,
      },
      writeProfiles: false,
      now: () => '2026-05-28T00:00:00.000Z',
    });
    const m = report.modules[0]!;
    const blocked = m.profile.blocked_metrics ?? [];
    expect(blocked.some((b) => b.startsWith('coverage:report_missing:'))).toBe(true);
  });

  it('marks source as from-report when caller overrides report paths', async () => {
    writeMap([{ slug: 'mod-a', sources: ['src/a/**'] }]);
    const lcovPath = join(root, 'override.info');
    writeFileSync(lcovPath, 'SF:src/a/x.ts\nLF:1\nLH:1\nend_of_record\n', 'utf8');
    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'lcov',
        public_api_extractor: null,
      },
      coverageReportPath: 'override.info',
      writeProfiles: false,
      now: () => '2026-05-28T00:00:00.000Z',
    });
    expect(report.source).toBe('from-report');
    expect(report.modules[0]?.profile.evidence?.rollup?.source).toBe('from-report');
  });
});

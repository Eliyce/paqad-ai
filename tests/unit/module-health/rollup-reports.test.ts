import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { rollupModuleHealth } from '@/module-health/rollup.js';

const NOW = '2026-05-28T00:00:00.000Z';

describe('module-health rollup report handling', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rollup-reports-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(
      join(root, PATHS.MODULE_MAP),
      [
        'modules:',
        '  - slug: core',
        '    sources: [src/core/**]',
        '  - slug: empty',
        '    sources: []',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rolls up junit tests by file, skips empty coverage rows and keeps settings it was given', async () => {
    writeFileSync(
      join(root, 'reports/junit.xml'),
      [
        '<testsuite>',
        '<testcase file="src/core/a.test.ts" name="ok"/>',
        '<testcase file="src/core/a.test.ts" name="bad"><failure/></testcase>',
        '<testcase file="lib/other.test.ts" name="elsewhere"/>',
        '<testcase name="no file"/>',
        '</testsuite>',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'reports/lcov.info'),
      ['SF:src/core/a.ts', 'LF:0', 'LH:0', 'end_of_record'].join('\n'),
    );

    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'lcov',
        coverage_path: join(root, 'reports/lcov.info'),
        test_report_format: 'junit-xml',
        test_report_path: 'reports/junit.xml',
        public_api_extractor: 'ts-morph',
        git_window_days: 7,
      },
      writeProfiles: false,
      now: () => NOW,
    });

    const core = report.modules.find((entry) => entry.slug === 'core')!.profile;
    expect(core.metrics).toMatchObject({
      coverage_pct: null,
      tests_passing: 1,
      tests_failing: 1,
      tests_total: 2,
    });
    expect(core.blocked_metrics).toContain('coverage_pct:no_matching_files');
    expect(core.blocked_metrics).not.toContain('contract_stability:no_public_api_extractor');
    expect(core.evidence.rollup).toMatchObject({ git_window_days: 7, source: 'rollup' });

    const empty = report.modules.find((entry) => entry.slug === 'empty')!.profile;
    expect(empty.blocked_metrics).toEqual(
      expect.arrayContaining(['change_velocity:unavailable', 'tests:no_matching_files']),
    );
    expect(report.unattributed_files).toEqual(['lib/other.test.ts']);
    expect(existsSync(join(root, PATHS.PLANNING_MODULE_HEALTH_DIR, 'core.json'))).toBe(false);
  });

  it('reports a missing report file and a format with no parser', async () => {
    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'no-such-format' as never,
        coverage_path: 'reports/coverage.xml',
        test_report_format: 'junit-xml',
        test_report_path: 'reports/missing.xml',
        public_api_extractor: null,
      },
      testReportPath: 'reports/missing.xml',
      writeProfiles: false,
      now: () => NOW,
    });

    writeFileSync(join(root, 'reports/coverage.xml'), '<x/>');
    const parserMissing = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'no-such-format' as never,
        coverage_path: 'reports/coverage.xml',
        public_api_extractor: null,
      },
      writeProfiles: false,
      now: () => NOW,
    });

    expect(report.source).toBe('from-report');
    expect(report.modules[0]!.profile.blocked_metrics).toEqual(
      expect.arrayContaining([
        'coverage:report_missing:reports/coverage.xml',
        'tests:report_missing:reports/missing.xml',
      ]),
    );
    expect(parserMissing.modules[0]!.profile.blocked_metrics).toEqual(
      expect.arrayContaining(['coverage:parser_missing:no-such-format', 'tests:not_configured']),
    );
  });

  it('takes nothing from a report whose format carries the other kind of rows', async () => {
    writeFileSync(join(root, 'reports/junit.xml'), '<testsuite></testsuite>');
    writeFileSync(join(root, 'reports/lcov.info'), 'SF:src/core/a.ts\nLF:4\nLH:4\nend_of_record\n');

    const report = await rollupModuleHealth({
      projectRoot: root,
      moduleHealth: {
        source_roots: ['src'],
        coverage_format: 'junit-xml',
        coverage_path: 'reports/junit.xml',
        test_report_format: 'lcov',
        test_report_path: 'reports/lcov.info',
        public_api_extractor: null,
      },
      writeProfiles: false,
      now: () => NOW,
    });

    expect(report.modules[0]!.profile.metrics).toMatchObject({
      coverage_pct: null,
      tests_total: null,
    });
  });
});

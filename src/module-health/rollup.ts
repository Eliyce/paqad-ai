// Test-driven module-health rollup. Issue #80, Phase 3.
//
// Reads the active stack pack's `module_health` block plus a coverage and/or
// test report (either from `test_command` output paths or `--from-report
// <path>`), maps covered/tested files to module slugs via `module-map.yml`'s
// `sources:` globs, then writes `.paqad/module-health/<slug>.json` in the
// extended shape (issue §6.4) with `blocked_metrics` populated for whatever
// could not be computed.
//
// Hard rule (spec): no metric is fabricated or zeroed. When a metric cannot
// be computed it is set to `null` and the reason recorded in
// `blocked_metrics`.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  _matchesAnyGlob,
  readRawModuleMap,
} from '@/module-map/reconciler.js';
import type {
  ModuleHealthMetrics,
  ModuleHealthProfile,
} from '@/core/types/planning.js';
import type { StackPackModuleHealthManifest } from '@/core/types/pack.js';
import { deriveHealthTier, writeModuleHealthProfile } from '@/planning/module-health.js';
import { toPosixPath } from '@/core/path-utils.js';

import {
  getParser,
  type CoverageFormat,
  type CoverageRow,
  type ParsedReport,
  type TestRow,
} from './parsers/index.js';

// Issue #80: tighter than the 30-day default the issue proposed.
export const DEFAULT_GIT_WINDOW_DAYS = 14;

export interface RollupOptions {
  projectRoot: string;
  // The active stack pack's module_health block. Required for non-blocked
  // runs; pass null to trigger the `module_health_unknown` hard-fail report.
  moduleHealth: StackPackModuleHealthManifest | null;
  // Override the coverage report path (otherwise pulled from
  // moduleHealth.coverage_path). Either an absolute path or relative to
  // projectRoot.
  coverageReportPath?: string;
  // Override the test-report path.
  testReportPath?: string;
  // When true, write each rolled-up profile to .paqad/module-health/<slug>.json
  // via writeModuleHealthProfile. When false, the caller gets the profiles
  // back without disk side effects (used by tests + dry runs).
  writeProfiles?: boolean;
  // When true, run `moduleHealth.test_command` before parsing. Disabled by
  // default — call sites that ship a test runner toggle this on; CLI users
  // typically `--from-report <path>` so this stays off in unit tests.
  runTestCommand?: boolean;
  // Optional ISO timestamp for deterministic output in tests.
  now?: () => string;
}

export type RollupBlocked = 'module_health_unknown';

export interface ModuleRollup {
  slug: string;
  profile: ModuleHealthProfile;
}

export interface RollupReport {
  generated_at: string;
  blocked: RollupBlocked | null;
  modules: ModuleRollup[];
  unattributed_files: string[];
  source: 'rollup' | 'from-report';
  formats: {
    coverage_format: string | null;
    test_report_format: string | null;
  };
}

interface ReadReportResult {
  parsed: ParsedReport;
  format: CoverageFormat;
}

function readReport(
  projectRoot: string,
  reportPath: string,
  format: CoverageFormat,
): ReadReportResult | { error: string } {
  const abs = reportPath.startsWith('/') ? reportPath : join(projectRoot, reportPath);
  if (!existsSync(abs)) {
    return { error: `report_missing:${reportPath}` };
  }
  const parser = getParser(format);
  if (parser === null) {
    return { error: `parser_missing:${format}` };
  }
  const content = readFileSync(abs, 'utf8');
  return { parsed: parser(content), format };
}

function assignToModule(
  filePath: string,
  modules: { slug: string; sources: string[] }[],
): string | null {
  const normalised = toPosixPath(filePath);
  for (const mod of modules) {
    if (_matchesAnyGlob(normalised, mod.sources)) return mod.slug;
  }
  return null;
}

type AttributedCoverageRow = CoverageRow & { slug: string | null };
type AttributedTestRow = TestRow & { slug: string | null };

function rollupCoverage(
  rows: AttributedCoverageRow[],
  slug: string,
): {
  pct: number | null;
  lines_total: number;
  lines_covered: number;
} {
  let total = 0;
  let covered = 0;
  let touched = false;
  for (const row of rows) {
    if (row.lines_total <= 0) continue;
    if (row.slug !== slug) continue;
    total += row.lines_total;
    covered += row.lines_covered;
    touched = true;
  }
  if (!touched || total === 0) {
    return { pct: null, lines_total: 0, lines_covered: 0 };
  }
  return {
    pct: Math.round((covered / total) * 100 * 100) / 100,
    lines_total: total,
    lines_covered: covered,
  };
}

function rollupTests(
  rows: AttributedTestRow[],
  slug: string,
): {
  passing: number | null;
  failing: number | null;
  total: number | null;
} {
  let passing = 0;
  let failing = 0;
  let total = 0;
  let touched = false;
  for (const row of rows) {
    if (row.slug !== slug) continue;
    passing += row.passing;
    failing += row.failing;
    total += row.total;
    touched = true;
  }
  return touched
    ? { passing, failing, total }
    : { passing: null, failing: null, total: null };
}

function changeVelocity(
  projectRoot: string,
  sources: string[],
  windowDays: number,
): number | null {
  if (sources.length === 0) return null;
  try {
    const since = `--since=${windowDays}.days.ago`;
    const args = ['log', '--pretty=oneline', since, '--', ...sources];
    const out = execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .length;
  } catch {
    return null;
  }
}

export async function rollupModuleHealth(opts: RollupOptions): Promise<RollupReport> {
  const now = (opts.now ?? (() => new Date().toISOString()))();

  if (opts.moduleHealth === null) {
    return {
      generated_at: now,
      blocked: 'module_health_unknown',
      modules: [],
      unattributed_files: [],
      source: 'rollup',
      formats: { coverage_format: null, test_report_format: null },
    };
  }

  const mh = opts.moduleHealth;
  const windowDays = mh.git_window_days ?? DEFAULT_GIT_WINDOW_DAYS;
  const source: 'rollup' | 'from-report' =
    opts.coverageReportPath || opts.testReportPath ? 'from-report' : 'rollup';

  // Resolve report paths. Either side may be absent — rollup runs with
  // whichever it can produce and records the missing one in blocked_metrics.
  const coveragePath = opts.coverageReportPath ?? mh.coverage_path;
  const coverageFormat = (mh.coverage_format ?? null) as CoverageFormat | null;
  const testReportPath = opts.testReportPath ?? mh.test_report_path;
  const testReportFormat = (mh.test_report_format ?? null) as CoverageFormat | null;

  const blockedGlobal: string[] = [];

  let coverage: CoverageRow[] = [];
  if (coveragePath && coverageFormat) {
    const result = readReport(opts.projectRoot, coveragePath, coverageFormat);
    if ('error' in result) {
      blockedGlobal.push(`coverage:${result.error}`);
    } else if (result.parsed.coverage) {
      coverage = result.parsed.coverage;
    }
  } else {
    blockedGlobal.push('coverage:not_configured');
  }

  let tests: TestRow[] = [];
  if (testReportPath && testReportFormat) {
    const result = readReport(opts.projectRoot, testReportPath, testReportFormat);
    if ('error' in result) {
      blockedGlobal.push(`tests:${result.error}`);
    } else if (result.parsed.tests) {
      tests = result.parsed.tests;
    }
  } else {
    blockedGlobal.push('tests:not_configured');
  }

  const rawMap = readRawModuleMap(opts.projectRoot);
  const modules = rawMap?.modules ?? [];

  // Pre-attribute each report row to a module slug once.
  const attributedCoverage: AttributedCoverageRow[] = coverage.map((row) => ({
    ...row,
    slug: assignToModule(row.file, modules),
  }));
  const attributedTests: AttributedTestRow[] = tests.map((row) => ({
    ...row,
    slug: row.file ? assignToModule(row.file, modules) : null,
  }));

  const unattributed = new Set<string>();
  for (const row of attributedCoverage) {
    if (row.slug === null) unattributed.add(row.file);
  }
  for (const row of attributedTests) {
    if (row.slug === null && row.file) unattributed.add(row.file);
  }

  const rollups: ModuleRollup[] = [];

  for (const mod of modules) {
    const blocked: string[] = [];
    const cov = rollupCoverage(attributedCoverage, mod.slug);
    if (cov.pct === null) {
      blocked.push(
        coveragePath && coverageFormat
          ? 'coverage_pct:no_matching_files'
          : 'coverage_pct:not_configured',
      );
    }

    const t = rollupTests(attributedTests, mod.slug);
    if (t.total === null) {
      blocked.push(
        testReportPath && testReportFormat
          ? 'tests:no_matching_files'
          : 'tests:not_configured',
      );
    }

    const velocity = changeVelocity(opts.projectRoot, mod.sources, windowDays);
    if (velocity === null) {
      blocked.push('change_velocity:unavailable');
    }

    // contract_stability requires a public_api_extractor; absent for every
    // shipped pack until the framework grows extractors. Surface the block
    // explicitly rather than zeroing the metric.
    const stability: number | null = null;
    if (!mh.public_api_extractor) {
      blocked.push('contract_stability:no_public_api_extractor');
    }

    const metrics: ModuleHealthMetrics = {
      coverage_pct: cov.pct,
      tests_passing: t.passing,
      tests_failing: t.failing,
      tests_total: t.total,
      change_velocity: velocity,
      contract_stability: stability,
      defect_frequency: null,
    };

    const profile: ModuleHealthProfile = {
      schema_version: 2,
      module: mod.slug,
      tier: deriveHealthTier(metrics),
      metrics,
      blocked_metrics: [...new Set([...blockedGlobal, ...blocked])].sort(),
      evidence: {
        rollup: {
          ...(coverageFormat ? { coverage_format: coverageFormat } : {}),
          ...(coveragePath ? { coverage_path: coveragePath } : {}),
          ...(testReportFormat ? { test_report_format: testReportFormat } : {}),
          ...(testReportPath ? { test_report_path: testReportPath } : {}),
          git_window_days: windowDays,
          ran_at: now,
          source,
        },
      },
      updated_at: now,
    };

    rollups.push({ slug: mod.slug, profile });
  }

  if (opts.writeProfiles !== false) {
    for (const r of rollups) {
      await writeModuleHealthProfile(opts.projectRoot, r.profile);
    }
  }

  return {
    generated_at: now,
    blocked: null,
    modules: rollups,
    unattributed_files: [...unattributed].sort(),
    source,
    formats: {
      coverage_format: coverageFormat,
      test_report_format: testReportFormat,
    },
  };
}


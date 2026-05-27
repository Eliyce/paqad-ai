import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { buildReport } from '@/dashboard/report';
import { DASHBOARD_SECTION_IDS } from '@/dashboard/types';

const NOW = Date.UTC(2026, 4, 26);

function bootstrap(root: string, projectName = 'demo'): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ framework_version: '1.0.0', project_root: '.' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: projectName, id: projectName, description: '' },
      commands: { install: 'pnpm i', test: 'pnpm test', build: 'pnpm build' },
      intelligence: { rag_enabled: false },
      mcp: { servers: [] },
      routing: { domain: 'coding' },
    }),
  );
}

describe('buildReport', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-report-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns a notOnboarded report when .paqad/ is absent', () => {
    const report = buildReport(root, { now: NOW });
    expect(report.notOnboarded).toBe(true);
    expect(report.sections).toEqual([]);
    expect(report.overallScore).toBeNull();
    expect(report.overallBand).toBe('unknown');
  });

  it('renders every section once for an onboarded project', () => {
    bootstrap(root);
    const report = buildReport(root, { now: NOW });
    expect(report.notOnboarded).toBe(false);
    expect(report.projectName).toBe('demo');
    const ids = report.sections.map((s) => s.id);
    // The contract list and the report must agree exactly on which
    // sections exist.
    expect(new Set(ids)).toEqual(new Set(DASHBOARD_SECTION_IDS));
    expect(ids.length).toBe(DASHBOARD_SECTION_IDS.length);
  });

  it('computes overallScore as the average of applicable sections', () => {
    bootstrap(root);
    const report = buildReport(root, { now: NOW });
    // At least one section (project-profile) is applicable, so overall
    // is not null.
    expect(report.overallScore).not.toBeNull();
    expect(report.overallBand).not.toBe('unknown');
  });

  it('caps the attention list at 5 items and orders critical first', () => {
    bootstrap(root);
    // Generate 4 fragile module-health entries (critical) + 2 ageing
    // pending decisions (warn/critical depending on age).
    const mhDir = join(root, '.paqad/module-health');
    mkdirSync(mhDir, { recursive: true });
    for (let i = 0; i < 4; i++) {
      writeFileSync(
        join(mhDir, `m${i}.json`),
        JSON.stringify({
          module: `m${i}`,
          tier: 'fragile',
          updated_at: new Date(NOW).toISOString(),
        }),
      );
    }
    const decDir = join(root, '.paqad/decisions/pending');
    mkdirSync(decDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      writeFileSync(
        join(decDir, `D-${i}.json`),
        JSON.stringify({
          id: `D-${i}`,
          title: `Decision ${i}`,
          created_at: new Date(NOW - 10 * 86_400_000).toISOString(),
        }),
      );
    }
    const report = buildReport(root, { now: NOW });
    expect(report.attention.length).toBe(5);
    // First items should all be critical.
    expect(report.attention[0]?.severity).toBe('critical');
  });
});

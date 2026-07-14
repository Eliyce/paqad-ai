import { describe, expect, it } from 'vitest';

import type { HealthFinding, HealthReportIndex } from '@/core/types/codebase-health.js';
import { buildHealthRetestFindings, buildRetestReportIndex } from '@/codebase-health/retest.js';

function finding(id: string, over: Partial<HealthFinding> = {}): HealthFinding {
  return {
    id,
    title: `t-${id}`,
    description: 'd',
    category: 'dead-code',
    severity: 'low',
    tier: 'deterministic',
    confidence: 0.9,
    evidence: [],
    suggestion: { action: 'remove', detail: 'x' },
    affected_files: [],
    affected_packages: [],
    requires_network: false,
    baseline_status: 'unknown',
    status: 'open',
    ...over,
  };
}

describe('buildHealthRetestFindings', () => {
  it('marks still-open when the id reappears and fixed when it does not', () => {
    const source = [finding('HL-1'), finding('HL-2')];
    const current = [finding('HL-1')];
    const retest = buildHealthRetestFindings(source, current, false);
    expect(retest.find((f) => f.id === 'HL-1')!.retest_status).toBe('still-open');
    expect(retest.find((f) => f.id === 'HL-2')!.retest_status).toBe('fixed');
  });

  it('marks a network-required finding needs-manual-verification when offline', () => {
    const source = [finding('HL-3', { requires_network: true })];
    const retest = buildHealthRetestFindings(source, [], true);
    expect(retest[0]!.retest_status).toBe('needs-manual-verification');
    expect(retest[0]!.status).toBe('needs-manual-verification');
  });
});

describe('buildRetestReportIndex', () => {
  it('names the report <orig-ts>-retest-<ts> and carries the source id + stack', () => {
    const source: HealthReportIndex = {
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: '1',
      report_id: 'HEALTH-2026-01-01-00-00-00',
      workflow: 'codebase-health',
      generated_at: '2026-01-01T00:00:00.000Z',
      report_path: 'docs/health/2026-01-01-00-00-00.md',
      sidecar_path: 'docs/health/2026-01-01-00-00-00.json',
      source_report_path: null,
      source_report_id: null,
      offline: false,
      stack: { primary: 'node', traits: ['ts'], toolchains: ['node'] },
      tool_availability: [],
      findings: [],
      blocked_checks: [],
      baseline: { existed: true, new_since_baseline: 0, pre_existing: 0 },
      sources_used: ['code-knowledge index'],
      next_remediation_priorities: [],
      raw_evidence_paths: [],
    };
    const report = buildRetestReportIndex({
      now: new Date(2026, 2, 1, 0, 0, 0),
      offline: false,
      source,
      retestFindings: [{ ...finding('HL-1'), retest_status: 'fixed' }],
    });
    expect(report.workflow).toBe('health-retest');
    expect(report.report_path).toContain('2026-01-01-00-00-00-retest-2026-03-01-00-00-00.md');
    expect(report.source_report_id).toBe('HEALTH-2026-01-01-00-00-00');
    expect(report.stack.traits).toEqual(['ts']);
  });
});

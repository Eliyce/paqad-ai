import { describe, expect, it } from 'vitest';

import type {
  HealthFinding,
  HealthReportIndex,
  HealthRetestFinding,
} from '@/core/types/codebase-health.js';
import {
  buildHealthMarkdown,
  nextRemediationPriorities,
} from '@/codebase-health/report-builder.js';

function finding(over: Partial<HealthFinding> = {}): HealthFinding {
  return {
    id: 'HL-1',
    title: 'Dead file: src/x.ts',
    description: 'why it matters',
    category: 'dead-code',
    severity: 'medium',
    tier: 'deterministic',
    confidence: 0.9,
    evidence: ['proof line'],
    suggestion: { action: 'remove', detail: 'delete it' },
    affected_files: ['src/x.ts'],
    affected_packages: [],
    requires_network: false,
    baseline_status: 'unknown',
    status: 'open',
    ...over,
  };
}

function report(over: Partial<HealthReportIndex> = {}): HealthReportIndex {
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: '1',
    report_id: 'HEALTH-2026',
    workflow: 'codebase-health',
    generated_at: '2026-07-14T00:00:00.000Z',
    report_path: 'docs/health/x.md',
    sidecar_path: 'docs/health/x.json',
    source_report_path: null,
    source_report_id: null,
    offline: true,
    stack: { primary: 'node', traits: [], toolchains: ['node'] },
    tool_availability: [],
    findings: [],
    blocked_checks: [],
    baseline: { existed: false, new_since_baseline: 0, pre_existing: 0 },
    sources_used: [],
    next_remediation_priorities: [],
    raw_evidence_paths: [],
    ...over,
  };
}

describe('nextRemediationPriorities', () => {
  it('is a placeholder when there are no findings', () => {
    expect(nextRemediationPriorities([])).toEqual(['No findings recorded.']);
  });

  it('orders by severity and caps at 5', () => {
    const findings = Array.from({ length: 7 }, (_, i) =>
      finding({ id: `HL-${i}`, severity: i === 0 ? 'high' : 'low', title: `t${i}` }),
    );
    const priorities = nextRemediationPriorities(findings);
    expect(priorities).toHaveLength(5);
    expect(priorities[0]).toContain('HL-0');
  });
});

describe('buildHealthMarkdown', () => {
  it('separates Proven from Needs judgment and never lists ai-judged under Proven', () => {
    const md = buildHealthMarkdown(
      report({
        findings: [
          finding({ id: 'HL-P', tier: 'deterministic', title: 'Proven one' }),
          finding({ id: 'HL-J', tier: 'ai-judged', title: 'Judged one', confidence: 0.4 }),
        ],
      }),
    );
    const provenIdx = md.indexOf('## Proven');
    const judgedIdx = md.indexOf('## Needs judgment');
    expect(md.slice(provenIdx, judgedIdx)).toContain('Proven one');
    expect(md.slice(provenIdx, judgedIdx)).not.toContain('Judged one');
    expect(md.slice(judgedIdx)).toContain('Judged one');
    expect(md.slice(judgedIdx)).toContain('needs your judgment');
  });

  it('renders empty sections, a retest line, baseline, and the source id', () => {
    const retest: HealthRetestFinding = {
      ...finding({ baseline_status: 'pre-existing' }),
      retest_status: 'fixed',
    };
    const md = buildHealthMarkdown(
      report({
        workflow: 'health-retest',
        source_report_id: 'HEALTH-orig',
        findings: [retest],
        blocked_checks: [{ check: 'duplication', reason: 'no jscpd', install_hint: 'install it' }],
        next_remediation_priorities: ['HL-1: Dead file'],
      }),
    );
    expect(md).toContain('Retest of: HEALTH-orig');
    expect(md).toContain('Retest: fixed');
    expect(md).toContain('Baseline: pre-existing');
    expect(md).toContain('## Needs judgment\n\n_None._');
    expect(md).toContain('duplication: no jscpd — install it');
  });

  it('says every check ran when nothing is blocked', () => {
    expect(buildHealthMarkdown(report())).toContain('_Every check ran._');
  });
});

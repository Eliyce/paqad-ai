import type {
  HealthFinding,
  HealthReportIndex,
  HealthRetestFinding,
} from '@/core/types/codebase-health.js';

import { HEALTH_REPORT_HEADER } from './copy.js';
import { sortFindings } from './shared.js';

const SEVERITY_RANK: Record<HealthFinding['severity'], number> = { high: 0, medium: 1, low: 2 };

function isRetest(finding: HealthFinding | HealthRetestFinding): finding is HealthRetestFinding {
  return 'retest_status' in finding;
}

/** Top-5 remediation priorities, most-severe first, formatted `id: title`. */
export function nextRemediationPriorities(findings: HealthFinding[]): string[] {
  const ordered = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  if (ordered.length === 0) return ['No findings recorded.'];
  return ordered.slice(0, 5).map((finding) => `${finding.id}: ${finding.title}`);
}

function renderFinding(finding: HealthFinding | HealthRetestFinding): string[] {
  const lines = [`### ${finding.id} — ${finding.title}`, ''];
  lines.push(`- Severity: ${finding.severity}`);
  lines.push(`- Category: ${finding.category}`);
  lines.push(`- Suggested action: ${finding.suggestion.action} — ${finding.suggestion.detail}`);
  if (finding.baseline_status !== 'unknown') {
    lines.push(`- Baseline: ${finding.baseline_status}`);
  }
  if (finding.tier === 'ai-judged') {
    lines.push(`- Confidence: ${finding.confidence.toFixed(2)} (needs your judgment)`);
  }
  if (isRetest(finding)) {
    lines.push(`- Retest: ${finding.retest_status}`);
  }
  lines.push('');
  lines.push(`Why it matters: ${finding.description}`);
  lines.push('');
  lines.push('Proof:');
  for (const item of finding.evidence) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  return lines;
}

function renderSection(title: string, findings: HealthFinding[]): string[] {
  const lines = [`## ${title}`, ''];
  if (findings.length === 0) {
    lines.push('_None._', '');
    return lines;
  }
  for (const finding of sortFindings(findings)) {
    lines.push(...renderFinding(finding));
  }
  return lines;
}

/** Render the full report markdown, honestly separating Proven from Needs judgment. */
export function buildHealthMarkdown(report: HealthReportIndex): string {
  const proven = report.findings.filter((finding) => finding.tier === 'deterministic');
  const judged = report.findings.filter((finding) => finding.tier === 'ai-judged');

  const lines: string[] = [
    `# ${report.report_id}`,
    '',
    HEALTH_REPORT_HEADER,
    '',
    `- Workflow: ${report.workflow}`,
    `- Generated: ${report.generated_at}`,
    `- Stack: ${report.stack.primary}`,
    `- Mode: ${report.offline ? 'offline' : 'online'}`,
    report.source_report_id ? `- Retest of: ${report.source_report_id}` : '',
    '',
    '## Summary',
    '',
    `- Proven findings: ${proven.length}`,
    `- Needs judgment: ${judged.length}`,
    `- New since baseline: ${report.baseline.new_since_baseline}`,
    `- Pre-existing: ${report.baseline.pre_existing}`,
    '',
    ...renderSection('Proven', proven),
    ...renderSection('Needs judgment', judged),
    '## Blocked checks',
    '',
  ];

  if (report.blocked_checks.length === 0) {
    lines.push('_Every check ran._', '');
  } else {
    for (const blocked of report.blocked_checks) {
      lines.push(`- ${blocked.check}: ${blocked.reason} — ${blocked.install_hint}`);
    }
    lines.push('');
  }

  lines.push('## Next remediation priorities', '');
  for (const priority of report.next_remediation_priorities) {
    lines.push(`- ${priority}`);
  }
  lines.push('');

  return `${lines.filter((line) => line !== null).join('\n')}\n`;
}

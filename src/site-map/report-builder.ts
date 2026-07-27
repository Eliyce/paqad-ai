// Render the site-map run report as human markdown. Mirrors codebase-health's report-builder:
// findings are split honestly into Proven (deterministic, Tier-A) and Needs judgment
// (ai-judged), blocked checks are surfaced as gaps (never hidden), and the top remediation
// priorities lead. No I/O — the orchestrator in `run.ts` writes the returned string.

import type {
  SiteMapFinding,
  SiteMapReportIndex,
  SiteMapRetestFinding,
} from '@/core/types/site-map-run.js';

import { sortFindings } from './shared.js';

/** Verbatim report header (paqad voice — plain words, proof-first, no jargon). */
export const SITE_MAP_REPORT_HEADER =
  '**Site map** — I reconciled this project against its behavioural map: the surfaces, ' +
  'transitions, and journeys under `docs/instructions/site-map/`. Every finding below carries ' +
  "proof (a `file:line` or a surface id); nothing here is a guess. Findings marked 'needs " +
  "judgment' are candidates I couldn't prove mechanically — you decide.";

const SEVERITY_RANK: Record<SiteMapFinding['severity'], number> = { high: 0, medium: 1, low: 2 };

function isRetest(finding: SiteMapFinding | SiteMapRetestFinding): finding is SiteMapRetestFinding {
  return 'retest_status' in finding;
}

/** Top-5 remediation priorities, most-severe first, formatted `id: title`. */
export function nextRemediationPriorities(findings: SiteMapFinding[]): string[] {
  const ordered = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  if (ordered.length === 0) return ['No findings recorded.'];
  return ordered.slice(0, 5).map((finding) => `${finding.id}: ${finding.title}`);
}

function renderFinding(finding: SiteMapFinding | SiteMapRetestFinding): string[] {
  const lines = [`### ${finding.id} — ${finding.title}`, ''];
  lines.push(`- Severity: ${finding.severity}`);
  lines.push(`- Category: ${finding.category}`);
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
  if (finding.affected_surfaces.length > 0) {
    lines.push(`Affected surfaces: ${finding.affected_surfaces.join(', ')}`);
    lines.push('');
  }
  lines.push('Proof:');
  for (const item of finding.evidence) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push(`Fix: ${finding.resolution}`);
  lines.push('');
  return lines;
}

function renderSection(title: string, findings: SiteMapFinding[]): string[] {
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

/** Render the full run-report markdown, separating Proven from Needs judgment. */
export function buildSiteMapMarkdown(report: SiteMapReportIndex): string {
  const proven = report.findings.filter((finding) => finding.tier === 'deterministic');
  const judged = report.findings.filter((finding) => finding.tier === 'ai-judged');

  const lines: string[] = [
    `# ${report.report_id}`,
    '',
    SITE_MAP_REPORT_HEADER,
    '',
    `- Workflow: ${report.workflow}`,
    `- Generated: ${report.generated_at}`,
    `- App: ${report.app.name} (${report.app.kind})`,
    report.source_report_id ? `- Retest of: ${report.source_report_id}` : '',
    '',
    '## Summary',
    '',
    `- Mapped surfaces: ${report.surface_count}`,
    `- Curated journeys: ${report.journey_count}`,
    `- Extracted surfaces: ${report.extraction.extracted_surfaces} ` +
      `(from ${report.extraction.extractors_ran} extractor(s))`,
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
    lines.push('_Every extractor ran._', '');
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

  return `${lines.join('\n')}\n`;
}

import { activeFeatureDirOrNull, readChecksReportForFeature } from '@/checks/report-target.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { formatRange } from '@/duplication/types.js';
import { readReport as readRuleScriptReport } from '@/rule-scripts/runner.js';
import { readVerificationEvidence } from '@/verification/evidence-markdown.js';

export type MachineFindingSeverity =
  'critical' | 'blocker' | 'high' | 'medium' | 'low' | 'nit' | 'info';

export type MachineFindingTier = 'deterministic' | 'heuristic';

export interface MachineFinding {
  source: string;
  severity: MachineFindingSeverity;
  tier: MachineFindingTier;
  file: string | null;
  line: string | null;
  message: string;
}

const HIGH_BAND: readonly MachineFindingSeverity[] = ['critical', 'blocker', 'high'];

function oneLine(message: string, max = 200): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export function findingAnchor(finding: MachineFinding): string | null {
  if (finding.file === null) return null;
  return finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
}

function ruleScriptRows(projectRoot: string): MachineFinding[] {
  const report = readRuleScriptReport(projectRoot);
  if (!report) return [];
  const rows: MachineFinding[] = [];
  for (const result of report.results) {
    for (const finding of result.findings) {
      rows.push({
        source: `rule:${result.rule_id}`,
        severity: finding.severity,
        tier: result.kind,
        file: finding.file,
        line: finding.line === undefined ? null : String(finding.line),
        message: oneLine(finding.message),
      });
    }
  }
  return rows;
}

function duplicationRows(projectRoot: string): MachineFinding[] {
  const report = readDuplicationReport(projectRoot);
  if (!report) return [];
  return report.findings.map((finding) => ({
    source: 'duplication',
    severity: finding.kind === 'deterministic' ? ('high' as const) : ('medium' as const),
    tier: finding.kind,
    file: finding.file,
    line: formatRange(finding.line_range),
    message: oneLine(finding.message),
  }));
}

function checksRows(projectRoot: string): MachineFinding[] {
  const report = readChecksReportForFeature(projectRoot, activeFeatureDirOrNull(projectRoot));
  if (!report) return [];
  const rows: MachineFinding[] = [];
  for (const result of report.results) {
    const runner = result.summary.runner_id;
    const failed = result.summary.failed + result.summary.errored;
    rows.push({
      source: 'checks',
      severity: failed > 0 ? 'high' : 'info',
      tier: 'deterministic',
      file: null,
      line: null,
      message: oneLine(
        failed > 0
          ? `${runner}: ${failed} failing of ${result.summary.total}`
          : `${runner}: ${result.summary.passed} passing of ${result.summary.total}`,
      ),
    });
    for (const failure of result.failures) {
      rows.push({
        source: `checks:${runner}`,
        severity: 'high',
        tier: 'deterministic',
        file: failure.file_path,
        line: failure.line_number === null ? null : String(failure.line_number),
        message: oneLine(`${failure.test_id}: ${failure.message}`),
      });
    }
  }
  return rows;
}

function gateRows(projectRoot: string): MachineFinding[] {
  const evidence = readVerificationEvidence(projectRoot);
  if (!evidence) return [];
  const rows: MachineFinding[] = [];
  for (const gate of evidence.gates) {
    if (gate.status !== 'fail' && gate.status !== 'inconclusive') continue;
    const severity: MachineFindingSeverity = gate.status === 'fail' ? 'high' : 'medium';
    if (gate.failures.length === 0) {
      rows.push({
        source: `gate:${gate.name}`,
        severity,
        tier: 'deterministic',
        file: null,
        line: null,
        message: oneLine(gate.detail),
      });
      continue;
    }
    for (const failure of gate.failures) {
      rows.push({
        source: `gate:${gate.name}`,
        severity,
        tier: 'deterministic',
        file: failure.file,
        line: failure.line === null ? null : String(failure.line),
        message: oneLine(failure.ac_id ? `${failure.ac_id}: ${failure.message}` : failure.message),
      });
    }
  }
  return rows;
}

export function collectMachineFindings(projectRoot: string): MachineFinding[] {
  return [
    ...ruleScriptRows(projectRoot),
    ...duplicationRows(projectRoot),
    ...checksRows(projectRoot),
    ...gateRows(projectRoot),
  ];
}

export function anchoringFindings(findings: MachineFinding[]): MachineFinding[] {
  return findings.filter(
    (finding) =>
      finding.tier === 'deterministic' &&
      HIGH_BAND.includes(finding.severity) &&
      findingAnchor(finding) !== null,
  );
}

export function unanchoredMachineFindings(
  findings: MachineFinding[],
  reviewText: string,
): MachineFinding[] {
  return anchoringFindings(findings).filter((finding) => {
    const anchor = findingAnchor(finding);
    return anchor !== null && !reviewText.includes(anchor);
  });
}

import type { Finding } from '@/rule-scripts/execute.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { runRuleScripts, type RuleComplianceMode } from '@/rule-scripts/runner.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';

export interface RuleViolation {
  rule_id: string;
  script: string;
  file: string;
  line?: number;
  message: string;
  severity: Finding['severity'];
}

export interface EnforcementResult {
  ran: boolean;
  mode: RuleComplianceMode;
  blocking: boolean;
  violations: RuleViolation[];
  armed: number;
  summary: string;
}

export type EnforceScope = 'changed-files' | 'whole-tree';

export interface EnforceOptions {
  projectRoot: string;
  mode: RuleComplianceMode;
  changedFiles?: string[];
  scope?: EnforceScope;
}

export async function enforceRuleScripts(options: EnforceOptions): Promise<EnforcementResult> {
  const { projectRoot, mode } = options;
  const map = loadRuleScriptMap(projectRoot);
  const armed = map ? map.rules.reduce((total, rule) => total + (rule.scripts?.length ?? 0), 0) : 0;
  if (mode === 'off' || armed === 0) {
    return { ran: false, mode, blocking: false, violations: [], armed, summary: '' };
  }

  const scope = options.scope ?? 'changed-files';
  const changedFiles = options.changedFiles ?? (await loadChangeEvidence(projectRoot)).files;

  if (scope === 'changed-files' && changedFiles.length === 0) {
    return {
      ran: false,
      mode,
      blocking: false,
      violations: [],
      armed,
      summary: '**▸ paqad** · ⚪ scripted rules: skipped (no files changed this turn)',
    };
  }

  const report = runRuleScripts({
    projectRoot,
    mode,
    changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
  });

  const violations: RuleViolation[] = report.results
    .filter((r) => !r.skipped && r.kind === 'deterministic')
    .flatMap((r) =>
      r.findings.map((f) => ({
        rule_id: r.rule_id,
        script: r.script,
        file: f.file,
        line: f.line,
        message: f.message,
        severity: f.severity,
      })),
    );

  return {
    ran: true,
    mode,
    blocking: report.blocking,
    violations,
    armed,
    summary: formatEnforcementSummary({ mode, blocking: report.blocking, violations }),
  };
}

export function formatEnforcementSummary(result: {
  mode: RuleComplianceMode;
  blocking: boolean;
  violations: RuleViolation[];
}): string {
  if (result.violations.length === 0) {
    return '**▸ paqad** · scripted rules: 🟢 all clear';
  }
  const verb = result.blocking ? 'Needs your attention' : 'Heads up';
  const glyph = result.blocking ? '🔴' : '🟡';
  const lines = result.violations
    .slice(0, 20)
    .map(
      (v) => `> - ${glyph} ${v.rule_id} · ${v.file}${v.line ? `:${v.line}` : ''} — ${v.message}`,
    );
  const more =
    result.violations.length > 20 ? `> - …and ${result.violations.length - 20} more\n` : '';
  const header = result.blocking
    ? 'I caught scripted-rule violations before this could ship — enforced even though their text was not loaded.'
    : 'Scripted-rule findings (warn mode, not blocking):';
  return `**▸ paqad** · ${verb}\n> ${header}\n${lines.join('\n')}\n${more}`.trimEnd();
}

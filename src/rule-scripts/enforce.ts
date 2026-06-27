/**
 * Live rule-script enforcement (RAG buildout F6).
 *
 * The linchpin that makes smart rule loading (F4/F5) safe: scripted rules are
 * enforced from the working tree regardless of whether their text is in context.
 * This wraps the existing {@link runRuleScripts} runner with the orchestration a
 * live hook needs — resolve the working set, run the registered scripts, and
 * reduce the report to a block/allow decision plus a human-readable summary.
 *
 * Enforcement is independent of the injection accelerator (`rag_enabled`): it is
 * a safety backstop, not context. It is gated only by paqad being enabled, the
 * `rule_compliance` mode, and a rule-script map actually existing.
 */
import { existsSync } from 'node:fs';

import type { Finding } from '@/rule-scripts/execute.js';
import { ruleScriptMapPath } from '@/rule-scripts/map.js';
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
  /** False when there was nothing to enforce (mode off, or no rule-script map). */
  ran: boolean;
  mode: RuleComplianceMode;
  /** True only in strict mode with at least one deterministic violation. */
  blocking: boolean;
  violations: RuleViolation[];
  /** Human-readable, paqad-voice summary (empty when nothing ran). */
  summary: string;
}

export interface EnforceOptions {
  projectRoot: string;
  mode: RuleComplianceMode;
  /** Working-set files; resolved from change-evidence when omitted. */
  changedFiles?: string[];
}

/**
 * Run the registered rule scripts against the working set and decide whether the
 * change is blocked. Fast-skips (no work, no `runRuleScripts` call) when the mode
 * is `off` or the project has no rule-script map — the common case.
 */
export async function enforceRuleScripts(options: EnforceOptions): Promise<EnforcementResult> {
  const { projectRoot, mode } = options;
  if (mode === 'off' || !existsSync(ruleScriptMapPath(projectRoot))) {
    return { ran: false, mode, blocking: false, violations: [], summary: '' };
  }

  const changedFiles = options.changedFiles ?? (await loadChangeEvidence(projectRoot)).files;
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
    summary: formatEnforcementSummary({ mode, blocking: report.blocking, violations }),
  };
}

/**
 * Render the paqad-voice summary for an enforcement result. A blocking result
 * reads as "needs your attention"; a non-blocking warn result surfaces the same
 * findings without halting.
 */
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

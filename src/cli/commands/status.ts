import { resolve } from 'node:path';

import { Command } from 'commander';

import { collectModuleDecisions } from '@/dashboard/collectors/module-decisions.js';
import { collectModuleHealth } from '@/dashboard/collectors/module-health.js';
import { renderMarkdown } from '@/dashboard/markdown.js';
import { buildReport } from '@/dashboard/report.js';
import { readDriftReport, driftReportHasFindings } from '@/module-map/reconciler.js';

interface StatusCommandOptions {
  format: string;
  projectRoot: string;
  failOnDrift: boolean;
}

export interface DriftSignals {
  mmFindings: number;
  staleModules: string[];
  expiredDecisions: string[];
  mmDocMissing: number;
  blocked: string | null;
}

// AC #35 — composes the four signals `status --fail-on-drift` trips on
// without re-walking the source artefacts. Public so unit tests can assert
// the matrix directly.
export function collectDriftSignals(projectRoot: string): DriftSignals {
  const drift = readDriftReport(projectRoot);
  const docMissing =
    drift?.findings.filter((f) => f.code === 'MM-DOC-MISSING').length ?? 0;
  const mmFindings = driftReportHasFindings(drift) ? drift?.findings.length ?? 0 : 0;
  const { staleModules } = collectModuleHealth(projectRoot);
  const { expiredIds } = collectModuleDecisions(projectRoot);
  return {
    mmFindings,
    staleModules,
    expiredDecisions: expiredIds,
    mmDocMissing: docMissing,
    blocked: drift?.blocked ?? null,
  };
}

export function driftSignalsTrip(signals: DriftSignals): boolean {
  return (
    signals.mmFindings > 0 ||
    signals.staleModules.length > 0 ||
    signals.expiredDecisions.length > 0 ||
    signals.mmDocMissing > 0 ||
    signals.blocked !== null
  );
}

/**
 * `paqad-ai status` — one-shot LLM-friendly snapshot of the dashboard
 * report. Reuses the same buildReport() pipeline the dashboard server
 * does, so what the agent sees matches what the human sees.
 */
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Print a one-shot dashboard report (Markdown or JSON)')
    .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--fail-on-drift',
      'Exit non-zero when module-map drift, stale module-health, expired MD-XXXX decisions, or MM-DOC-MISSING findings are present',
      false,
    )
    .action((options: StatusCommandOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const fmt = options.format.toLowerCase();
      if (fmt !== 'markdown' && fmt !== 'json') {
        process.stderr.write(
          `error: invalid --format value '${options.format}' (expected markdown or json)\n`,
        );
        process.exitCode = 2;
        return;
      }
      const report = buildReport(projectRoot);
      const output = fmt === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report);
      process.stdout.write(`${output}\n`);

      if (options.failOnDrift) {
        const signals = collectDriftSignals(projectRoot);
        if (driftSignalsTrip(signals)) {
          const reasons: string[] = [];
          if (signals.blocked !== null) reasons.push(`reconciler blocked: ${signals.blocked}`);
          if (signals.mmFindings > 0) reasons.push(`${signals.mmFindings} MM-* finding(s)`);
          if (signals.mmDocMissing > 0) reasons.push(`${signals.mmDocMissing} MM-DOC-MISSING`);
          if (signals.staleModules.length > 0) {
            reasons.push(`${signals.staleModules.length} stale module(s)`);
          }
          if (signals.expiredDecisions.length > 0) {
            reasons.push(`${signals.expiredDecisions.length} expired decision(s)`);
          }
          process.stderr.write(`status: --fail-on-drift tripped — ${reasons.join('; ')}\n`);
          process.exitCode = 3;
        }
      }
    });
}

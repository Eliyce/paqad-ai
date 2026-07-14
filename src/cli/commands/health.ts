// `paqad-ai health run|retest` (issue #355) — the single source of truth for the
// codebase-health workflow. `run` does all detection deterministically (zero model
// tokens) and dual-writes the report; `retest` re-runs the evidence and reclassifies
// each prior finding by its stable id. Exit codes follow the audit convention:
// 0 clean · 1 findings (or still-open on retest) · 2 an unexpected error.

import { Command } from 'commander';

import { runHealthAudit } from '@/codebase-health/run.js';
import { runHealthRetest } from '@/codebase-health/retest-run.js';

interface RunFlags {
  projectRoot: string;
  offline: boolean;
  quiet: boolean;
}

interface RetestFlags {
  projectRoot: string;
  offline: boolean;
  sidecar?: string;
  quiet: boolean;
}

export function createHealthCommand(): Command {
  const command = new Command('health').description(
    'Audit the project for dead code, unused/risky packages, secrets, stale docs, and AI slop',
  );

  command
    .command('run')
    .description('Scan the project and write a health report with proof per finding')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--offline', 'Skip checks that need the network and say so in the report', false)
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RunFlags) => {
      try {
        const result = await runHealthAudit({
          projectRoot: options.projectRoot,
          offline: options.offline,
        });
        if (result.finding_count === 0) {
          console.log('**▸ paqad** · codebase health — nothing to clean up. Safe to merge.');
        } else {
          console.log(
            `**▸ paqad** · codebase health — found ${result.finding_count} thing(s) worth a look. Needs your attention.`,
          );
        }
        console.log(`> Report: ${result.report_path}`);
        for (const blocked of result.blocked_checks) {
          console.log(`> ⚪ ${blocked.check} skipped — ${blocked.reason}`);
        }
        if (result.baseline_created) {
          console.log('> Baseline recorded — future runs will flag only what is new.');
        }
        process.exitCode = result.exit_code;
        if (!options.quiet) {
          console.log(
            JSON.stringify({
              report_id: result.report_id,
              report_path: result.report_path,
              sidecar_path: result.sidecar_path,
              findings: result.finding_count,
              blocked_checks: result.blocked_checks.length,
              baseline_created: result.baseline_created,
            }),
          );
        }
      } catch (error) {
        console.error(`**▸ paqad** · health run failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  command
    .command('retest')
    .description('Re-run the evidence and reclassify each prior finding by its stable id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--offline', 'Skip checks that need the network', false)
    .option('--sidecar <path>', 'A specific source sidecar (defaults to the newest report)')
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RetestFlags) => {
      try {
        const result = await runHealthRetest({
          projectRoot: options.projectRoot,
          offline: options.offline,
          sidecar: options.sidecar ?? null,
        });
        if (!result.ok) {
          console.error(`**▸ paqad** · ${result.reason}`);
          process.exitCode = 2;
          return;
        }
        console.log(
          `**▸ paqad** · health retest — ${result.fixed} fixed, ${result.still_open} still open, ` +
            `${result.needs_manual_verification} need a manual check.`,
        );
        console.log(`> Report: ${result.report_path}`);
        process.exitCode = result.exit_code;
        if (!options.quiet) {
          console.log(
            JSON.stringify({
              report_id: result.report_id,
              report_path: result.report_path,
              sidecar_path: result.sidecar_path,
              fixed: result.fixed,
              still_open: result.still_open,
              needs_manual_verification: result.needs_manual_verification,
            }),
          );
        }
      } catch (error) {
        console.error(`**▸ paqad** · health retest failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  return command;
}

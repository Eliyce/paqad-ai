// `paqad-ai sitemap run` — the deterministic Site Map engine's CLI surface. `run` scans the
// project through the production gatherer, reconciles the extracted surfaces against the
// canonical map, and dual-writes the report (zero model tokens). Exit codes follow the audit
// convention: 0 clean · 1 findings · 2 an unexpected error. `retest` lands with S11.

import { Command } from 'commander';

import { createSiteMapGatherer } from '@/site-map/gatherer.js';
import { runSiteMapAudit } from '@/site-map/run.js';

interface RunFlags {
  projectRoot: string;
  quiet: boolean;
}

export function createSitemapCommand(): Command {
  const command = new Command('sitemap').description(
    'Map the application — surfaces, transitions, guards, and curated journeys',
  );

  command
    .command('run')
    .description('Scan the app, reconcile it against the map, and write a site-map report')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RunFlags) => {
      try {
        const result = await runSiteMapAudit({
          projectRoot: options.projectRoot,
          gatherer: createSiteMapGatherer(options.projectRoot),
        });
        if (result.finding_count === 0) {
          console.log('**▸ paqad** · site map — the map matches the code. Safe to merge.');
        } else {
          console.log(
            `**▸ paqad** · site map — found ${result.finding_count} thing(s) worth a look. Needs your attention.`,
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
        console.error(`**▸ paqad** · sitemap run failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  return command;
}

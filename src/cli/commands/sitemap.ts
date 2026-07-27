// `paqad-ai sitemap run|retest` — the deterministic Site Map engine's CLI surface. `run` scans
// the project through the production gatherer, reconciles the extracted surfaces against the
// canonical map, and dual-writes the report (zero model tokens). `retest` replays a prior report
// against the current code, reclassifying each finding by its stable `SM-` id. Exit codes follow
// the audit convention: 0 clean · 1 findings/still-open · 2 an unexpected error.

import { Command } from 'commander';

import { createSiteMapGatherer } from '@/site-map/gatherer.js';
import { runSiteMapRetest } from '@/site-map/retest-run.js';
import { runSiteMapAudit } from '@/site-map/run.js';

interface RunFlags {
  projectRoot: string;
  quiet: boolean;
}

interface RetestFlags extends RunFlags {
  sidecar?: string;
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

  command
    .command('retest')
    .description('Replay a prior site-map report against the current code, matched by stable id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--sidecar <path>',
      'Source report sidecar (defaults to the newest docs/site-map/*.json)',
    )
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RetestFlags) => {
      try {
        const result = await runSiteMapRetest({
          projectRoot: options.projectRoot,
          gatherer: createSiteMapGatherer(options.projectRoot),
          sidecar: options.sidecar ?? null,
        });
        if (!result.ok) {
          console.error(`**▸ paqad** · sitemap retest: ${result.reason}`);
          process.exitCode = 2;
          return;
        }
        if (result.still_open === 0) {
          console.log('**▸ paqad** · site-map retest — nothing still open. Safe to merge.');
        } else {
          console.log(
            `**▸ paqad** · site-map retest — ${result.still_open} still open. Needs your attention.`,
          );
        }
        console.log(
          `> Fixed: ${result.fixed} · Still open: ${result.still_open} · ` +
            `Needs a manual check: ${result.needs_manual_verification}`,
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
        console.error(`**▸ paqad** · sitemap retest failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  return command;
}

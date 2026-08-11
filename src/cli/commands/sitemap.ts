// `paqad-ai sitemap run` — the deterministic Site Map engine's CLI surface. `run` scans the
// project through the production gatherer, reconciles the extracted surfaces against the
// canonical map, and re-earns the stored map's trust tiers and freshness (zero model tokens).
// A re-run is simply the same action run again (issue #466, ART-3) — there is no separate
// retest engine. Exit codes follow the audit convention: 0 clean · 1 findings · 2 an
// unexpected error.

import { Command } from 'commander';

import { createSiteMapGatherer } from '@/site-map/gatherer.js';
import { runJourneyCuration, type JourneyCurationAction } from '@/site-map/journey-curation.js';
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
    .description('Check the stored map against the code and re-earn its trust and freshness')
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
        for (const blocked of result.blocked_checks) {
          console.log(`> ⚪ ${blocked.check} skipped — ${blocked.reason}`);
        }
        if (result.trust_restamp.status === 'stamped') {
          console.log(`> Stamped earned trust and freshness into ${result.trust_restamp.path}`);
        }
        if (result.baseline_created) {
          console.log('> Baseline recorded — future runs will flag only what is new.');
        }
        process.exitCode = result.exit_code;
        if (!options.quiet) {
          console.log(
            JSON.stringify({
              report_id: result.report_id,
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

  const journey = command
    .command('journey')
    .description('Curate proposed journeys — the human sign-off that confirms or removes them');

  for (const action of ['confirm', 'reject'] as JourneyCurationAction[]) {
    journey
      .command(action)
      .description(
        action === 'confirm'
          ? 'Confirm a proposed journey (proposed → confirmed)'
          : 'Reject a proposed journey (removes it from the map)',
      )
      .argument('<id>', 'Journey id under docs/instructions/site-map/journeys/')
      .option('--project-root <path>', 'Project root', process.cwd())
      .action((id: string, options: { projectRoot: string }) => {
        try {
          const result = runJourneyCuration({ projectRoot: options.projectRoot, id, action });
          if (!result.ok) {
            console.error(`**▸ paqad** · sitemap journey ${action}: ${result.reason}`);
            process.exitCode = 1;
            return;
          }
          console.log(
            result.status === 'confirmed'
              ? `**▸ paqad** · journey "${id}" confirmed — it is now part of the map.`
              : `**▸ paqad** · journey "${id}" rejected — removed from the map.`,
          );
          process.exitCode = 0;
        } catch (error) {
          console.error(
            `**▸ paqad** · sitemap journey ${action} failed: ${(error as Error).message}`,
          );
          process.exitCode = 2;
        }
      });
  }

  return command;
}

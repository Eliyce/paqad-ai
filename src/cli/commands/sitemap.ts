// `paqad-ai sitemap run` — the deterministic Site Map engine's CLI surface. `run` scans the
// project through the production gatherer, reconciles the extracted surfaces against the
// canonical map, and re-earns the stored map's trust tiers and freshness (zero model tokens).
// A re-run is simply the same action run again (issue #466, ART-3) — there is no separate
// retest engine. Exit codes follow the audit convention: 0 clean · 1 findings · 2 an
// unexpected error.

import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import {
  deriveCreationQuestions,
  parseCreationDecisions,
  recordCreationAnswers,
} from '@/site-map/creation-flow.js';
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

  command
    .command('questions')
    .description(
      'List the closed-list creation questions the authored map still needs answered (one-step creation)',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      try {
        const result = deriveCreationQuestions(options.projectRoot);
        if (result.status === 'no-map') {
          console.log(
            '**▸ paqad** · site map — no authored map yet, so there is nothing to ask. Write docs/site-map/app-map.yaml first.',
          );
          console.log(JSON.stringify({ status: 'no-map', to_ask: [] }));
          return;
        }
        const { to_ask, reused, reopened } = result.reconciliation;
        if (to_ask.length === 0) {
          console.log('**▸ paqad** · site map — the map is fully decided. Nothing left to ask.');
        } else {
          console.log(
            `**▸ paqad** · site map — ${to_ask.length} question(s) need your call before the map is settled.`,
          );
        }
        console.log(
          JSON.stringify({ status: 'ready', to_ask, reused_count: reused.length, reopened }),
        );
      } catch (error) {
        console.error(`**▸ paqad** · sitemap questions failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  command
    .command('answer')
    .description(
      'Record the answered creation questions and stamp their provenance onto the map (one-step creation)',
    )
    .requiredOption('--input <path>', 'JSON file of [{ question_id, answer, decided_by }]')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { input: string; projectRoot: string }) => {
      try {
        const raw = readFileSync(options.input, 'utf8');
        const decisions = parseCreationDecisions(raw);
        const result = recordCreationAnswers(options.projectRoot, decisions);
        if (result.status === 'no-map') {
          console.error(
            '**▸ paqad** · site map — no authored map to record answers against. Write docs/site-map/app-map.yaml first.',
          );
          process.exitCode = 1;
          return;
        }
        console.log(
          `**▸ paqad** · site map — recorded ${result.recorded} answer(s) to the map's creation questions.`,
        );
        if (result.unknown.length > 0) {
          console.log(
            `> ⚪ Skipped ${result.unknown.length} answer(s) with no current question: ${result.unknown.join(', ')}`,
          );
        }
        if (result.stamped && result.map_path !== null) {
          console.log(`> Stamped who-decided provenance onto ${result.map_path}`);
        }
        process.exitCode = 0;
      } catch (error) {
        console.error(`**▸ paqad** · sitemap answer failed: ${(error as Error).message}`);
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
      .argument('<id>', 'Journey id under docs/site-map/journeys/')
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

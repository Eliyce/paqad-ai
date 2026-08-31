// `paqad-ai sitemap run` — the deterministic Site Map engine's CLI surface. `run` scans the
// project through the production gatherer, reconciles the extracted surfaces against the
// canonical map, and re-earns the stored map's trust tiers and freshness (zero model tokens).
// A re-run is simply the same action run again (issue #466, ART-3) — there is no separate
// retest engine. Exit codes follow the audit convention: 0 clean · 1 findings · 2 an
// unexpected error.

import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import type { SiteMapVerdict } from '@/core/types/site-map-run.js';
import {
  deriveCreationQuestions,
  parseCreationDecisions,
  recordCreationAnswers,
} from '@/site-map/creation-flow.js';
import { buildSiteMapDraft } from '@/site-map/draft.js';
import { createSiteMapGatherer } from '@/site-map/gatherer.js';
import { runJourneyCuration, type JourneyCurationAction } from '@/site-map/journey-curation.js';
import { readProgress, summarizeProgress } from '@/site-map/progress-store.js';
import {
  deriveSiteMapInventory,
  describeSiteMapInventory,
  gatherSiteMapReport,
  runSiteMapAudit,
} from '@/site-map/run.js';
import { writeCanonicalSiteMap } from '@/site-map/store.js';

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
        // Speak the verdict in the paqad contract words. A run over an absent or link-less map
        // reads Inconclusive, never "Safe to merge" (D4): only a real, navigable, unblocked map
        // with no findings earns the clean line.
        const verdictLine: Record<SiteMapVerdict, string> = {
          safe: '**▸ paqad** · site map — the map matches the code. Safe to merge.',
          attention: `**▸ paqad** · site map — found ${result.finding_count} thing(s) worth a look. Needs your attention.`,
          inconclusive:
            '**▸ paqad** · site map — could not confirm the map against the code. Inconclusive.',
        };
        console.log(verdictLine[result.verdict]);
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
              verdict: result.verdict,
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
    .command('draft')
    .description(
      'Write the map skeleton from the extracted surfaces — the engine drafts, you add meaning',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      try {
        // Gather read-only through the same seam `inventory` uses, then write the skeleton straight
        // from what extraction proved (S8a). Nothing is invented here — one surface per extracted
        // surface, evidence unchanged, no transitions or journeys — so the model adds meaning to a
        // grounded map instead of retyping hundreds of entries (D2). `writeCanonicalSiteMap`
        // validates before persisting, so a schema-invalid draft can never land on disk.
        const gathered = await gatherSiteMapReport({
          projectRoot: options.projectRoot,
          gatherer: createSiteMapGatherer(options.projectRoot),
          workflow: 'site-map',
          now: new Date(),
        });
        const map = buildSiteMapDraft(gathered.extraction, gathered.report.app);
        const path = writeCanonicalSiteMap(options.projectRoot, map);
        console.log(
          `**▸ paqad** · site map — drafted ${map.surfaces.length} surface(s) into ${path}. Add the meaning the code does not carry, then run \`sitemap run\` to prove it.`,
        );
        process.exitCode = 0;
      } catch (error) {
        console.error(`**▸ paqad** · sitemap draft failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  command
    .command('inventory')
    .description('Report how many screens, groups and guards the code has — a read-only preview')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RunFlags) => {
      try {
        // A read-only gather (no bundle, no baseline, no ledger row), so `inventory` is safe to
        // run at any time — it only says how big the job is before any write (S4, AC-2).
        const gathered = await gatherSiteMapReport({
          projectRoot: options.projectRoot,
          gatherer: createSiteMapGatherer(options.projectRoot),
          workflow: 'site-map',
          now: new Date(),
        });
        const inventory = deriveSiteMapInventory(gathered.extraction);
        console.log(`**▸ paqad** · site map — ${describeSiteMapInventory(inventory)}`);
        process.exitCode = 0;
        if (!options.quiet) {
          console.log(JSON.stringify(inventory));
        }
      } catch (error) {
        console.error(`**▸ paqad** · sitemap inventory failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  command
    .command('status')
    .description('Show how far the last mapping run got and what a resumed run would do next')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      // A readout, not a gate (S5b). It reads through `readProgress` only — a tolerant, write-free
      // read that never resets a `writing` unit (AC-4) — so `status` is safe to run at any moment,
      // including while a run is in flight. There is deliberately no try/catch → exit 2: readProgress
      // never throws and summarizeProgress is pure, so a catch branch would be unreachable, and AC-3
      // requires status to always exit 0 regardless.
      const progress = await readProgress(options.projectRoot);
      if (progress === null) {
        console.log(
          '**▸ paqad** · site map — no progress recorded yet, so a run would start from the beginning.',
        );
        console.log(JSON.stringify({ status: 'none' }));
        process.exitCode = 0;
        return;
      }
      const summary = summarizeProgress(progress);
      const nextLine =
        summary.next === null
          ? 'Nothing left to do.'
          : `Next up: ${summary.next.id} (${summary.next.label}).`;
      console.log(
        `**▸ paqad** · site map — ${summary.done} of ${summary.total} done, ${summary.writing} writing, ${summary.failed} failed, ${summary.remaining} to go. ${nextLine}`,
      );
      console.log(JSON.stringify({ status: 'ready', ...summary }));
      process.exitCode = 0;
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

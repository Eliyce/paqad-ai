import { existsSync, readFileSync } from 'node:fs';

import { Command } from 'commander';

import type { SiteMapVerdict } from '@/core/types/site-map-run.js';
import { hashSourceFiles } from '@/document/staleness.js';
import {
  deriveCreationQuestions,
  parseCreationDecisions,
  recordCreationAnswers,
} from '@/site-map/creation-flow.js';
import { buildSiteMapDraft, deriveDraftUnits, mergeSiteMapDraft } from '@/site-map/draft.js';
import { createSiteMapGatherer, gatherSiteMapTransitions } from '@/site-map/gatherer.js';
import { runJourneyCuration, type JourneyCurationAction } from '@/site-map/journey-curation.js';
import {
  completeUnit,
  createEmptyProgress,
  createUnit,
  readProgress,
  reconcileDoneUnits,
  recoverInFlight,
  saveProgress,
  startUnit,
  summarizeProgress,
} from '@/site-map/progress-store.js';
import {
  deriveSiteMapInventory,
  describeSiteMapInventory,
  gatherSiteMapReport,
  runSiteMapAudit,
} from '@/site-map/run.js';
import {
  canonicalAppMapPath,
  readCanonicalSiteMap,
  writeCanonicalSiteMap,
} from '@/site-map/store.js';
import {
  attachResolvedTransitions,
  buildUnresolvedLinksCheck,
  resolveTransitions,
} from '@/site-map/transitions.js';

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
        const verdictLine: Record<SiteMapVerdict, string> = {
          safe: '**▸ paqad** · site map — the map matches the code. Safe to merge.',
          attention: `**▸ paqad** · site map — found ${result.finding_count} thing(s) worth a look. Needs your attention.`,
          inconclusive:
            '**▸ paqad** · site map — could not confirm the map against the code. Inconclusive.',
        };
        console.log(verdictLine[result.verdict]);
        const linkNoun = result.transition_count === 1 ? 'link' : 'links';
        console.log(`> ${result.transition_count} navigation ${linkNoun} recorded in the map.`);
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
              transitions: result.transition_count,
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
    .description("Write the map's starting skeleton from the code so you only fill in the meaning")
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      try {
        const root = options.projectRoot;
        const existing = readCanonicalSiteMap(root);
        if (existing === null && existsSync(canonicalAppMapPath(root))) {
          console.error(
            '**▸ paqad** · sitemap draft refused: docs/site-map/app-map.yaml exists but is not a readable, schema-valid map, and drafting over it would destroy authored content. Fix or remove the file, then re-run.',
          );
          process.exitCode = 2;
          return;
        }

        const gathered = await gatherSiteMapReport({
          projectRoot: root,
          gatherer: createSiteMapGatherer(root),
          workflow: 'site-map',
          now: new Date(),
        });
        const inventory = deriveSiteMapInventory(gathered.extraction);
        const unitDefs = deriveDraftUnits(gathered.extraction);

        let progress = await readProgress(root);
        if (progress === null) {
          progress = createEmptyProgress(inventory, new Date());
        } else {
          progress.inventory = { screens: inventory.screens, groups: [...inventory.groups] };
        }
        await recoverInFlight(root, progress);
        for (const def of unitDefs) {
          const unit = progress.units[def.id];
          if (unit === undefined) {
            progress.units[def.id] = createUnit({
              id: def.id,
              kind: 'group',
              label: def.label,
              artifact: null,
              source_files: def.source_files,
            });
          } else {
            unit.source_files = [...def.source_files];
          }
        }
        const { skipped } = await reconcileDoneUnits(root, progress);
        await saveProgress(root, progress, new Date());

        const skeleton = buildSiteMapDraft(gathered.extraction, gathered.report.app);
        const transitions = gatherSiteMapTransitions(root, gathered.extraction.surfaces);
        const resolution = resolveTransitions(transitions, skeleton.surfaces);
        const draft = {
          ...skeleton,
          surfaces: attachResolvedTransitions(skeleton.surfaces, resolution.resolved),
        };
        const defsById = new Map(unitDefs.map((def) => [def.id, def]));
        let map = existing;
        let mapPath: string | null = null;
        let appended = 0;
        for (const unit of Object.values(progress.units)) {
          if (unit.state === 'done') continue;
          const surfaceIds = new Set(defsById.get(unit.id)?.surface_ids ?? []);
          startUnit(unit, new Date());
          await saveProgress(root, progress, new Date());
          const before = map === null ? 0 : map.surfaces.length;
          map = mergeSiteMapDraft(map, draft, surfaceIds);
          mapPath = writeCanonicalSiteMap(root, map);
          appended += map.surfaces.length - before;
          completeUnit(unit, await hashSourceFiles(root, unit.source_files), new Date());
          await saveProgress(root, progress, new Date());
        }
        if (map === null) {
          map = draft;
          mapPath = writeCanonicalSiteMap(root, map);
          appended = draft.surfaces.length;
        }

        const kept = existing === null ? 0 : existing.surfaces.length;
        if (mapPath === null) {
          console.log(
            `**▸ paqad** · site map — nothing to redraw: ${skipped.length} unchanged group(s), the map at ${canonicalAppMapPath(root)} is already up to date (kept ${kept} existing surface(s)).`,
          );
        } else {
          console.log(
            `**▸ paqad** · site map — drafted ${appended} new surface(s) into ${mapPath} (kept ${kept} existing, skipped ${skipped.length} unchanged group(s)). Add the meaning the code does not carry, then run \`sitemap run\` to prove it.`,
          );
        }
        const unresolved = buildUnresolvedLinksCheck(resolution.dropped);
        if (unresolved !== null) {
          console.log(`**▸ paqad** · site map — ${unresolved.reason} ${unresolved.install_hint}`);
        }
        process.exitCode = 0;
      } catch (error) {
        console.error(`**▸ paqad** · sitemap draft failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  command
    .command('inventory')
    .description(
      'Report how many screens, groups and guards the code has without changing anything',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (options: RunFlags) => {
      try {
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
    .description('List the questions the map still needs you to answer')
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
    .description('Record your answers to those questions and note who decided each')
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
    .description('Confirm or remove the journeys the map has proposed');

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

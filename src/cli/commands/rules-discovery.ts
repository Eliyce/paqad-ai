import { Command } from 'commander';

import { listUnjudgedDecisions, validateFromDecisions } from '@/rules-discovery/decisions.js';
import { readJsonFile } from '@/rules-discovery/files.js';
import { inventorySummary, writeStackInventory } from '@/rules-discovery/inventory.js';
import { absRunFile, isRunId, mintRunId } from '@/rules-discovery/paths.js';
import {
  checkResearch,
  markResearched,
  nextTargets,
  readResearchFiles,
  startResearch,
  stopResearch,
  writeCheckedSources,
  type ResearchProgress,
} from '@/rules-discovery/research.js';
import type { StackInventory } from '@/rules-discovery/types.js';

interface InventoryOptions {
  projectRoot: string;
  run?: string;
  json: boolean;
}

interface ResearchOptions {
  projectRoot: string;
  run: string;
  offline: boolean;
  done?: string;
  stop: boolean;
  check: boolean;
}

export function readRunInventory(projectRoot: string, runId: string): StackInventory | null {
  const read = readJsonFile<StackInventory>(absRunFile(projectRoot, runId, 'inventory'));
  if (read.state !== 'ok') {
    refuse(`stack-inventory.json is ${read.state} in run ${runId}; run the inventory step first.`);
    return null;
  }
  return read.value;
}

function researchReport(progress: ResearchProgress): void {
  const next = nextTargets(progress);
  const words: Record<ResearchProgress['state'], string> = {
    'in-progress': `${progress.done.length} of ${progress.order.length} packages researched; next: ${next[0]?.name ?? 'none'}`,
    'skipped-offline':
      'research skipped: no network. The run goes on with decisions and existing rules.',
    stopped: `research stopped with ${progress.unreached.length} package(s) not reached; say "discover rules" to continue from ${next[0]?.name ?? 'the first unreached package'}`,
    done: `research covered all ${progress.order.length} packages`,
  };
  const privateNote =
    progress.skipped_private.length === 0
      ? ''
      : ` ${progress.skipped_private.length} skipped: private.`;
  say(`research — ${words[progress.state]}.${privateNote}`);
  console.log(
    JSON.stringify({
      state: progress.state,
      next: next.map((target) => target.name),
      unreached: progress.unreached,
      skipped_private: progress.skipped_private,
    }),
  );
}

interface DecisionsOptions {
  projectRoot: string;
  check?: string;
}

export function say(line: string): void {
  console.log(`**▸ paqad** · rules discovery · ${line}`);
}

export function refuse(line: string): void {
  console.error(`**▸ paqad** · rules discovery · ${line}`);
  process.exitCode = 1;
}

export function validRunOption(run: string | undefined): boolean {
  if (run !== undefined && !isRunId(run)) {
    refuse(`"${run}" is not a rules discovery run id.`);
    return false;
  }
  return true;
}

export function registerRulesDiscoveryCommands(command: Command): void {
  command
    .command('inventory')
    .description(
      'List every package the project uses (manifests, lockfiles, imports) into the rules discovery run folder',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--run <id>', 'Rules discovery run id (a new one is minted when absent)')
    .option('--json', 'Print the inventory as JSON', false)
    .action(async (options: InventoryOptions) => {
      if (!validRunOption(options.run)) return;
      const runId = options.run ?? mintRunId(new Date());
      const inventory = await writeStackInventory({ projectRoot: options.projectRoot, runId });
      say(`inventory — ${inventorySummary(inventory)}`);
      if (options.json) {
        console.log(JSON.stringify(inventory));
      }
    });

  const discovery = new Command('discovery').description(
    'Rules discovery verbs: decisions, status, apply and the run steps between them',
  );

  discovery
    .command('decisions')
    .description('List resolved decisions not yet judged by rules discovery (JSON on stdout)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--check <run>', "Validate the run's from-decisions.json against the listed decisions")
    .action((options: DecisionsOptions) => {
      const listed = listUnjudgedDecisions(options.projectRoot);
      if (options.check !== undefined) {
        if (!validRunOption(options.check)) return;
        const read = readJsonFile<unknown>(
          absRunFile(options.projectRoot, options.check, 'fromDecisions'),
        );
        if (read.state !== 'ok') {
          refuse(`from-decisions.json is ${read.state} in run ${options.check}.`);
          return;
        }
        const problems = validateFromDecisions(read.value, new Set(listed.map((d) => d.id)));
        if (problems.length > 0) {
          refuse(`from-decisions.json has ${problems.length} problem(s): ${problems.join('; ')}`);
          return;
        }
        say('from-decisions.json is valid.');
        return;
      }
      say(`${listed.length} resolved decision${listed.length === 1 ? '' : 's'} not yet judged.`);
      console.log(JSON.stringify({ decisions: listed }));
    });

  discovery
    .command('research')
    .description(
      'Track sourced research per package: plan and resume, mark a package done, stop, or check the files',
    )
    .requiredOption('--run <id>', 'Rules discovery run id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--offline', 'No network: skip research and go on with decisions and rules', false)
    .option('--done <package>', 'Mark one package researched')
    .option('--stop', 'Record that research stopped before every package was reached', false)
    .option('--check', 'Check from-research.json and sources.json and mark old sources', false)
    .action((options: ResearchOptions) => {
      if (!validRunOption(options.run)) return;
      const inventory = readRunInventory(options.projectRoot, options.run);
      if (inventory === null) return;
      try {
        if (options.check) {
          const files = readResearchFiles(options.projectRoot, options.run);
          const checked = checkResearch({ ...files, inventory, now: new Date() });
          if (checked.problems.length > 0) {
            refuse(
              `research has ${checked.problems.length} problem(s): ${checked.problems.join('; ')}`,
            );
            return;
          }
          writeCheckedSources(options.projectRoot, options.run, checked.sources);
          say(
            `research files are valid: ${files.ideas.length} idea(s), ${checked.sources.length} source(s).`,
          );
          return;
        }
        if (options.done !== undefined) {
          const key = options.done.includes(':')
            ? options.done
            : (inventory.packages.find((pkg) => pkg.name === options.done)?.ecosystem ?? 'node') +
              `:${options.done}`;
          researchReport(markResearched(options.projectRoot, options.run, key));
          return;
        }
        if (options.stop) {
          researchReport(stopResearch(options.projectRoot, options.run));
          return;
        }
        researchReport(
          startResearch(options.projectRoot, options.run, inventory, {
            offline: options.offline,
          }),
        );
      } catch (error) {
        refuse(error instanceof Error ? error.message : String(error));
      }
    });

  command.addCommand(discovery);
}

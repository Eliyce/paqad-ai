import { Command } from 'commander';

import { listUnjudgedDecisions, validateFromDecisions } from '@/rules-discovery/decisions.js';
import { readJsonFile } from '@/rules-discovery/files.js';
import { inventorySummary, writeStackInventory } from '@/rules-discovery/inventory.js';
import { absRunFile, isRunId, mintRunId } from '@/rules-discovery/paths.js';

interface InventoryOptions {
  projectRoot: string;
  run?: string;
  json: boolean;
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

  command.addCommand(discovery);
}

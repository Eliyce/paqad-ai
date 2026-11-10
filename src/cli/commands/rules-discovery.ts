import type { Command } from 'commander';

import { inventorySummary, writeStackInventory } from '@/rules-discovery/inventory.js';
import { isRunId, mintRunId } from '@/rules-discovery/paths.js';

interface InventoryOptions {
  projectRoot: string;
  run?: string;
  json: boolean;
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
      if (options.run !== undefined && !isRunId(options.run)) {
        console.error(`**▸ paqad** · "${options.run}" is not a rules discovery run id.`);
        process.exitCode = 1;
        return;
      }
      const runId = options.run ?? mintRunId(new Date());
      const inventory = await writeStackInventory({ projectRoot: options.projectRoot, runId });
      console.log(`**▸ paqad** · rules discovery · inventory — ${inventorySummary(inventory)}`);
      if (options.json) {
        console.log(JSON.stringify(inventory));
      }
    });
}

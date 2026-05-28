import { Command } from 'commander';

import {
  expireStaleDecisions,
  listDecisions,
  readDecision,
} from '@/module-decisions/store.js';

export function createModuleDecisionsCommand(): Command {
  const command = new Command('module-decisions').description(
    'Inspect MD-XXXX prospective module decisions (issue #80)',
  );

  command
    .command('list')
    .description('List all MD-XXXX decisions on disk')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--state <state>', 'Filter by state (proposed | accepted | rejected | expired | superseded | draft)')
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((options: { projectRoot: string; state?: string; json: boolean }) => {
      const all = listDecisions(options.projectRoot);
      const filtered = options.state !== undefined ? all.filter((d) => d.state === options.state) : all;

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log('No module decisions.');
        return;
      }

      for (const d of filtered) {
        console.log(
          `${d.id}  [${d.state}]  ${d.proposed_slug}  →  ${d.proposed_name}  (confidence: ${d.confidence})`,
        );
      }
    });

  command
    .command('show <id>')
    .description('Show a single MD-XXXX decision in full')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((id: string, options: { projectRoot: string }) => {
      const decision = readDecision(options.projectRoot, id);
      if (decision === null) {
        console.error(`Decision ${id} not found.`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(decision, null, 2));
    });

  command
    .command('expire-stale')
    .description('Transition past-TTL proposed decisions to "expired"')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((options: { projectRoot: string; json: boolean }) => {
      const moved = expireStaleDecisions(options.projectRoot);
      if (options.json) {
        console.log(JSON.stringify({ expired: moved }));
        return;
      }
      if (moved.length === 0) {
        console.log('No decisions to expire.');
        return;
      }
      console.log(`Expired ${moved.length} decision(s):`);
      for (const id of moved) console.log(`  ${id}`);
    });

  return command;
}

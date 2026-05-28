// `paqad-ai module-events` — inspect the .paqad/module-map/events.jsonl
// audit trail written by module-decisions (accept), module-map (reconcile),
// and module-health (rollup). Issue #80, Phase 4 (AC #34).
//
// Three read-only subcommands:
//   list [--limit N] [--json]
//   since <ISO-date>          [--json]
//   for-module <slug>         [--json]

import { Command } from 'commander';

import {
  readModuleMapEvents,
  readModuleMapEventsForSlug,
  readModuleMapEventsSince,
  type ModuleMapEvent,
} from '@/module-decisions/events.js';

function formatEvent(e: ModuleMapEvent): string {
  const slug = e.slug ? ` ${e.slug}` : '';
  const via = e.via ? ` via=${e.via}` : '';
  return `${e.ts}  ${e.type}${slug}${via}`;
}

function emit(events: ModuleMapEvent[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (events.length === 0) {
    console.log('No events.');
    return;
  }
  for (const e of events) console.log(formatEvent(e));
}

export function createModuleEventsCommand(): Command {
  const command = new Command('module-events').description(
    'Inspect the module-map events.jsonl audit trail (issue #80)',
  );

  command
    .command('list')
    .description('List recent events from .paqad/module-map/events.jsonl')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--limit <n>', 'Show only the most recent N entries', (v) => Number(v))
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((options: { projectRoot: string; limit?: number; json: boolean }) => {
      const all = readModuleMapEvents(options.projectRoot);
      const limit =
        typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
          ? Math.floor(options.limit)
          : null;
      const slice = limit === null ? all : all.slice(-limit);
      emit(slice, options.json);
    });

  command
    .command('since <iso>')
    .description('List events at or after the given ISO timestamp')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((iso: string, options: { projectRoot: string; json: boolean }) => {
      if (!Number.isFinite(Date.parse(iso))) {
        process.stderr.write(`error: invalid ISO timestamp '${iso}'\n`);
        process.exitCode = 2;
        return;
      }
      emit(readModuleMapEventsSince(options.projectRoot, iso), options.json);
    });

  command
    .command('for-module <slug>')
    .description('List events for a specific module slug')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((slug: string, options: { projectRoot: string; json: boolean }) => {
      emit(readModuleMapEventsForSlug(options.projectRoot, slug), options.json);
    });

  return command;
}

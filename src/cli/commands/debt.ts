import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { resolveDebtContext } from '@/tech-debt/context.js';
import {
  DEBT_STATUSES,
  closeTechDebt,
  listDebtItems,
  promoteTechDebt,
  raiseTechDebt,
  type DebtStatus,
  type TechDebtItem,
} from '@/tech-debt/index.js';

interface CommonOptions {
  projectRoot: string;
  session?: string;
}

interface AddOptions extends CommonOptions {
  title: string;
  kind: string;
  severity: string;
  file: string[];
  bodyFile?: string;
  agent?: string;
}

interface ListOptions extends CommonOptions {
  status: string;
  change?: string;
  format: string;
}

const LIST_STATUSES = [...DEBT_STATUSES, 'all'] as const;
const LIST_FORMATS = ['text', 'json'] as const;

function sessionHint(options: CommonOptions): string | null {
  return options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
}

function activeBundle(options: CommonOptions): { dirName: string | null; sessionId: string } {
  const context = resolveDebtContext(options.projectRoot, sessionHint(options));
  return { dirName: context.dirName, sessionId: context.session };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function guarded(run: () => void): void {
  try {
    run();
  } catch (error) {
    fail((error as Error).message);
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function itemPath(item: TechDebtItem): string {
  return `${PATHS.TECH_DEBT_DIR}/${item.id}.md`;
}

function withProjectRoot(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)');
}

export function createDebtCommand(): Command {
  const command = new Command('debt').description(
    'Record findings this change will not fix as tracked tech-debt items',
  );

  withProjectRoot(
    command
      .command('add')
      .description('Record one out-of-scope finding as a TD-<ULID> item')
      .requiredOption('--title <text>', 'one-line title')
      .requiredOption('--kind <kind>', 'bug, debt, gap or follow-up')
      .requiredOption('--severity <level>', 'low, medium or high')
      .option('--file <path>', 'a file the finding is about (repeatable)', collect, [])
      .option('--body-file <md>', 'markdown file holding the details')
      .option('--agent <name>', 'who found it (default orchestrator)'),
  ).action((options: AddOptions) => {
    guarded(() => {
      const root = options.projectRoot;
      const body =
        options.bodyFile === undefined ? '' : readFileSync(resolve(root, options.bodyFile), 'utf8');
      const context = resolveDebtContext(root, sessionHint(options));
      const result = raiseTechDebt(
        root,
        {
          title: options.title,
          kind: options.kind,
          severity: options.severity,
          files: options.file,
          body,
          foundBy: options.agent,
          foundIn: context.foundIn,
          session: context.session,
        },
        new Date(),
        { dirName: context.dirName, sessionId: context.session },
      );
      const said = {
        created: `recorded ${result.id} as tech debt`,
        existing: `${result.id} already records this finding; nothing written`,
        reopened: `reopened ${result.id}; the same finding came back`,
      }[result.outcome];
      console.log(`**▸ paqad** · ${said}.`);
      console.log(
        JSON.stringify({ id: result.id, outcome: result.outcome, path: itemPath(result.item) }),
      );
    });
  });

  withProjectRoot(
    command
      .command('list')
      .description('List tech-debt items')
      .option('--status <status>', `one of ${LIST_STATUSES.join(', ')}`, 'open')
      .option('--change <ref>', 'current, or a change ULID')
      .option('--format <format>', 'text or json', 'text'),
  ).action((options: ListOptions) => {
    guarded(() => {
      if (!(LIST_STATUSES as readonly string[]).includes(options.status)) {
        fail(`--status must be one of ${LIST_STATUSES.join(', ')}; got "${options.status}".`);
        return;
      }
      if (!(LIST_FORMATS as readonly string[]).includes(options.format)) {
        fail(`--format must be one of ${LIST_FORMATS.join(', ')}; got "${options.format}".`);
        return;
      }
      let change: string | null | undefined = options.change;
      if (change === 'current') {
        change = resolveDebtContext(options.projectRoot, sessionHint(options)).foundIn.change;
        if (change === null) {
          fail('no active change; pass a change ULID or leave --change off');
          return;
        }
      }
      const items = listDebtItems(options.projectRoot, {
        status: options.status as DebtStatus | 'all',
        change,
      });
      if (options.format === 'json') {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (items.length === 0) {
        console.log('No tech-debt items match.');
        return;
      }
      for (const item of items) {
        console.log(
          `${item.id}  ${item.status}  (${item.kind}, ${item.severity})  ${item.title.replace(/\s+/g, ' ')}`,
        );
      }
    });
  });

  withProjectRoot(
    command
      .command('promote')
      .description('Record that an item became an issue')
      .argument('<id>', 'the TD-<ULID> id')
      .requiredOption('--issue <ref>', 'the issue it became'),
  ).action((id: string, options: CommonOptions & { issue: string }) => {
    guarded(() => {
      const item = promoteTechDebt(options.projectRoot, id, options.issue, activeBundle(options));
      console.log(`**▸ paqad** · ${item.id} promoted to ${item.issue}.`);
      console.log(JSON.stringify({ id: item.id, status: item.status, issue: item.issue }));
    });
  });

  withProjectRoot(
    command
      .command('close')
      .description('Close an item with the reason')
      .argument('<id>', 'the TD-<ULID> id')
      .requiredOption('--reason <why>', 'why it is closed'),
  ).action((id: string, options: CommonOptions & { reason: string }) => {
    guarded(() => {
      const item = closeTechDebt(options.projectRoot, id, options.reason, activeBundle(options));
      console.log(`**▸ paqad** · ${item.id} closed.`);
      console.log(
        JSON.stringify({ id: item.id, status: item.status, closed_reason: item.closed_reason }),
      );
    });
  });

  return command;
}

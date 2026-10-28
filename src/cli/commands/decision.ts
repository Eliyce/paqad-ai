import { Command } from 'commander';

import {
  addWriteInOption,
  createPendingDecision,
  listContractDecisions,
  resolvePendingDecision,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';
import { writeFeatureDecisionsIndex } from '@/feature-evidence/decisions-index.js';
import { activeChangeKey, resolveActiveChange } from '@/feature-evidence/stage-ledger.js';
import { DECISION_CATEGORIES } from '@/planning/decision-packet.js';

function collectOption(
  value: string,
  previous: ContractDecisionOption[] = [],
): ContractDecisionOption[] {
  const eq = value.indexOf('=');
  if (eq === -1) {
    throw new Error(`--option must be <key>=<label>, got "${value}"`);
  }
  return [...previous, { option_key: value.slice(0, eq), label: value.slice(eq + 1) }];
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function nearestCategory(input: string): string {
  let best: string = DECISION_CATEGORIES[0];
  let bestDist = Infinity;
  for (const category of DECISION_CATEGORIES) {
    const dist = editDistance(input, category);
    if (dist < bestDist) {
      bestDist = dist;
      best = category;
    }
  }
  return best;
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

interface CreateOptions {
  projectRoot: string;
  category: string;
  title: string;
  context: string;
  option?: ContractDecisionOption[];
  recommendation?: string;
  session?: string;
}

interface ResolveOptions {
  projectRoot: string;
  other?: string;
  session?: string;
}

export function createDecisionCommand(): Command {
  const command = new Command('decision').description(
    'Create, resolve, or list Decision Pause packets (the install-resolved verb the ' +
      'Decision Pause Contract names — works in any onboarded project)',
  );

  command
    .command('create')
    .description('Open a decision packet (mints a D-<ULID> id; validates the category)')
    .requiredOption('--category <category>', 'one of the Decision Pause categories')
    .requiredOption('--title <title>', 'short title')
    .requiredOption('--context <context>', 'why this decision is needed')
    .option('--option <key=label>', 'an option (repeatable, at least 2)', collectOption)
    .option('--recommendation <key>', 'option_key you recommend')
    .option('--session <id>', 'Session whose active change the packet belongs to')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: CreateOptions) => {
      if (!(DECISION_CATEGORIES as readonly string[]).includes(options.category)) {
        fail(
          `Unknown category "${options.category}". Did you mean "${nearestCategory(options.category)}"? ` +
            `Valid categories: ${DECISION_CATEGORIES.join(', ')}.`,
        );
        return;
      }
      try {
        const result = createPendingDecision(options.projectRoot, {
          category: options.category,
          title: options.title,
          context: options.context,
          options: options.option ?? [],
          recommendation: options.recommendation ?? null,
          change: activeChangeKey(options.projectRoot, options.session),
        });
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  command
    .command('resolve')
    .description('Resolve a pending packet (moves it to resolved/); --other adds a write-in')
    .argument('<id>', 'the D-<ULID> id')
    .argument('<chosen>', 'the chosen option_key (ignored when --other is given)')
    .argument('[rationale...]', 'optional free-text rationale')
    .option('--other <text>', 'resolve to a minted write-in option with this label')
    .option('--session <id>', 'Session whose active change the decision belongs to')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((id: string, chosen: string, rationale: string[], options: ResolveOptions) => {
      try {
        const chosenKey = options.other
          ? addWriteInOption(options.projectRoot, id, options.other)
          : chosen;
        const active = resolveActiveChange(options.projectRoot, options.session);
        const { path } = resolvePendingDecision(
          options.projectRoot,
          id,
          chosenKey,
          rationale.join(' '),
          { change: active ? active.key : null },
        );
        if (active) {
          writeFeatureDecisionsIndex(options.projectRoot, active.dirName, {
            sessionId: active.sessionId,
          });
        }
        console.log(JSON.stringify({ path, chosen: chosenKey }, null, 2));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  command
    .command('list')
    .description('List pending and resolved decision packets')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'emit machine-readable JSON')
    .action((options: { projectRoot: string; json?: boolean }) => {
      const rows = listContractDecisions(options.projectRoot);
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log('No decision packets found.');
        return;
      }
      for (const row of rows) {
        console.log(`${row.status.padEnd(8)} ${row.id}  [${row.category}]  ${row.title}`);
      }
    });

  return command;
}

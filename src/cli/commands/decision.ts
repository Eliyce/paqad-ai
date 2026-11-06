import { Command } from 'commander';

import {
  addWriteInOption,
  answerPendingDecision,
  assertAlwaysAllowed,
  createPendingDecision,
  listContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';
import {
  assertEarlierCheckDone,
  checkDecision,
  formatCreateOutput,
  suggestEarlierAnswer,
} from '@/decisions/earlier-answers.js';
import {
  assertNotStageAgent,
  listStandingAnswers,
  removeStandingAnswer,
} from '@/decisions/standing-answers.js';
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

function failWith(error: unknown): void {
  fail(error instanceof Error ? error.message : String(error));
}

interface CreateOptions {
  projectRoot: string;
  category: string;
  title: string;
  context: string;
  option?: ContractDecisionOption[];
  recommendation?: string;
  session?: string;
  askAnyway?: boolean;
}

interface ResolveOptions {
  projectRoot: string;
  other?: string;
  always?: boolean;
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
    .option('--ask-anyway', 'Open the question even when a standing answer matches')
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
          askAnyway: options.askAnyway === true,
        });
        if (result.reused) {
          const active = resolveActiveChange(options.projectRoot, options.session);
          if (active) {
            writeFeatureDecisionsIndex(options.projectRoot, active.dirName, {
              sessionId: active.sessionId,
            });
          }
        }
        console.log(JSON.stringify(formatCreateOutput(options.projectRoot, result), null, 2));
      } catch (error) {
        failWith(error);
      }
    });

  command
    .command('resolve')
    .description('Resolve a pending packet (moves it to resolved/); --other adds a write-in')
    .argument('<id>', 'the D-<ULID> id')
    .argument('<chosen>', 'the chosen option_key (ignored when --other is given)')
    .argument('[rationale...]', 'optional free-text rationale')
    .option('--other <text>', 'resolve to a minted write-in option with this label')
    .option('--always', 'also keep this answer as a standing answer for this question')
    .option('--session <id>', 'Session whose active change the decision belongs to')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((id: string, chosen: string, rationale: string[], options: ResolveOptions) => {
      try {
        if (options.always) assertAlwaysAllowed(options.projectRoot, id, options.other);
        assertEarlierCheckDone(options.projectRoot, id);
        const chosenKey = options.other
          ? addWriteInOption(options.projectRoot, id, options.other)
          : chosen;
        const active = resolveActiveChange(options.projectRoot, options.session);
        const { path, rule } = answerPendingDecision(
          options.projectRoot,
          id,
          chosenKey,
          rationale.join(' '),
          { change: active ? active.key : null, always: options.always === true },
        );
        if (active) {
          writeFeatureDecisionsIndex(options.projectRoot, active.dirName, {
            sessionId: active.sessionId,
          });
        }
        console.log(
          JSON.stringify(
            { path, chosen: chosenKey, ...(rule ? { standing_answer: rule.id } : {}) },
            null,
            2,
          ),
        );
      } catch (error) {
        failWith(error);
      }
    });

  command
    .command('check')
    .description('Print the earlier answers to check first, or the question block once checked')
    .argument('<id>', 'the D-<ULID> id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((id: string, options: { projectRoot: string }) => {
      try {
        console.log(JSON.stringify(checkDecision(options.projectRoot, id), null, 2));
      } catch (error) {
        failWith(error);
      }
    });

  command
    .command('suggest')
    .description('Record which earlier answer fits this question, or that none does')
    .argument('<id>', 'the D-<ULID> id')
    .option('--earlier <id>', 'the earlier decision whose answer fits')
    .option('--option <key>', "this question's option_key for that answer")
    .option('--none', 'no earlier answer fits')
    .option('--reason <text>', 'why it fits, or why none does')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(
      (
        id: string,
        options: {
          projectRoot: string;
          earlier?: string;
          option?: string;
          none?: boolean;
          reason?: string;
        },
      ) => {
        try {
          console.log(
            JSON.stringify(suggestEarlierAnswer(options.projectRoot, id, options), null, 2),
          );
        } catch (error) {
          failWith(error);
        }
      },
    );

  const standing = command
    .command('standing')
    .description('List or remove the standing answers that skip a question');

  standing
    .command('list')
    .description('Print the standing answers')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      try {
        console.log(JSON.stringify(listStandingAnswers(options.projectRoot), null, 2));
      } catch (error) {
        failWith(error);
      }
    });

  standing
    .command('remove')
    .description('Remove one standing answer, so its question is asked again')
    .argument('<id>', 'the rule id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((id: string, options: { projectRoot: string }) => {
      try {
        assertNotStageAgent('remove a standing answer');
        const rule = removeStandingAnswer(options.projectRoot, id);
        console.log(JSON.stringify({ removed: rule.id }, null, 2));
      } catch (error) {
        failWith(error);
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

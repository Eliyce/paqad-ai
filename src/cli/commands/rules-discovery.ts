import { Command } from 'commander';

import { listUnjudgedDecisions, validateFromDecisions } from '@/rules-discovery/decisions.js';
import { applyProposal, scriptableOffer } from '@/rules-discovery/apply.js';
import { docsStep } from '@/rules-discovery/docs.js';
import { readJsonFile } from '@/rules-discovery/files.js';
import { proposeStep, reviewStep, signoffStep } from '@/rules-discovery/flow.js';
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
import { ROW_VERDICTS, signoffQuestion, type Verdict } from '@/rules-discovery/proposal.js';
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

interface StepOptions {
  projectRoot: string;
  run: string;
  expectRevision?: number;
}

interface ReviewOptions {
  projectRoot: string;
  run: string;
  row: string;
  verdict: string;
  text?: string;
}

export function parseRevision(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`"${value}" is not a run revision`);
  }
  return parsed;
}

export function guarded(work: () => void): void {
  try {
    work();
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
  }
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

  discovery
    .command('propose')
    .description(
      'Merge existing rules, decision ideas and research ideas into proposal.json and proposal.md',
    )
    .requiredOption('--run <id>', 'Rules discovery run id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--expect-revision <n>', 'run.json revision the caller last read', parseRevision)
    .action((options: StepOptions) => {
      if (!validRunOption(options.run)) return;
      guarded(() => {
        const result = proposeStep(
          options.projectRoot,
          options.run,
          new Date(),
          options.expectRevision,
        );
        for (const row of result.stale) say(`stale — ${row.row_id}: ${row.why}.`);
        if (result.current) {
          say('propose — your rules are current: nothing to add, change or remove.');
          return;
        }
        const open = result.proposal.rows.filter((row) => row.verdict === null).length;
        say(
          `propose — ${result.proposal.rows.length} row(s), ${result.proposal.folded.length} folded into existing rules, ${open} still need a verdict.`,
        );
      });
    });

  discovery
    .command('review')
    .description('Record a keep, edit or drop verdict for one proposal row')
    .requiredOption('--run <id>', 'Rules discovery run id')
    .requiredOption('--row <id>', 'Proposal row id (P-1, P-2, ...)')
    .requiredOption('--verdict <verdict>', 'keep, edit, drop, keep_existing or take_new')
    .option('--text <text>', 'New rule text for an edit verdict')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: ReviewOptions) => {
      if (!validRunOption(options.run)) return;
      const known = new Set<string>(Object.values(ROW_VERDICTS).flat());
      if (!known.has(options.verdict)) {
        refuse(`"${options.verdict}" is not a verdict.`);
        return;
      }
      guarded(() => {
        const proposal = reviewStep(
          options.projectRoot,
          options.run,
          options.row,
          options.verdict as Verdict,
          options.text,
        );
        const open = proposal.rows.filter((row) => row.verdict === null).length;
        say(`review — ${options.row} is ${options.verdict}; ${open} row(s) left.`);
      });
    });

  discovery
    .command('sign-off')
    .description('Open the one rules.proposal decision bound to the hash of proposal.json')
    .requiredOption('--run <id>', 'Rules discovery run id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--expect-revision <n>', 'run.json revision the caller last read', parseRevision)
    .action((options: StepOptions) => {
      if (!validRunOption(options.run)) return;
      guarded(() => {
        const result = signoffStep(
          options.projectRoot,
          options.run,
          new Date(),
          options.expectRevision,
        );
        say(`sign-off — ${signoffQuestion(result.counts)} Decision ${result.decision_id}.`);
        console.log(JSON.stringify(result));
      });
    });

  discovery
    .command('apply')
    .description(
      'Write the signed-off proposal: add, edit and archive rules, tag decisions, move the baseline',
    )
    .requiredOption('--run <id>', 'Rules discovery run id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--expect-revision <n>', 'run.json revision the caller last read', parseRevision)
    .action((options: StepOptions) => {
      if (!validRunOption(options.run)) return;
      guarded(() => {
        const report = applyProposal(options.projectRoot, options.run, {
          expectedRevision: options.expectRevision,
        });
        say(
          `apply — ${report.added} added, ${report.changed} changed, ${report.removed} removed, ${report.tagged} decision(s) tagged.`,
        );
        for (const row of report.refused) say(`refused — ${row.row_id}: ${row.why}.`);
        const offer = scriptableOffer(report);
        if (offer !== null) say(offer);
        console.log(JSON.stringify(report));
      });
    });

  discovery
    .command('docs')
    .description('Refresh the stack docs managed blocks from the run inventory and finish the run')
    .requiredOption('--run <id>', 'Rules discovery run id')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--expect-revision <n>', 'run.json revision the caller last read', parseRevision)
    .action(async (options: StepOptions) => {
      if (!validRunOption(options.run)) return;
      try {
        const result = await docsStep(
          options.projectRoot,
          options.run,
          new Date(),
          options.expectRevision,
        );
        say(`docs — ${result.updated.length} stack doc(s) updated.`);
      } catch (error) {
        refuse(error instanceof Error ? error.message : String(error));
      }
    });

  command.addCommand(discovery);
}

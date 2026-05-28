import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { candidatesNeedingDecision, extractCandidates } from '@/module-decisions/extractor.js';
import { inferAttribution } from '@/module-decisions/inferencer.js';
import { expireStaleDecisions, listDecisions, readDecision } from '@/module-decisions/store.js';
import { loadModuleMap } from '@/onboarding/registry-generator.js';

function readPromptArg(opts: { prompt?: string; promptFile?: string }): string {
  if (typeof opts.promptFile === 'string' && opts.promptFile.length > 0) {
    return readFileSync(opts.promptFile, 'utf8');
  }
  if (typeof opts.prompt === 'string') return opts.prompt;
  throw new Error('Must provide --prompt <text> or --prompt-file <path>');
}

export function createModuleDecisionsCommand(): Command {
  const command = new Command('module-decisions').description(
    'Inspect MD-XXXX prospective module decisions (issue #80)',
  );

  command
    .command('list')
    .description('List all MD-XXXX decisions on disk')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--state <state>',
      'Filter by state (proposed | accepted | rejected | expired | superseded | draft)',
    )
    .option('--json', 'Emit JSON instead of human-readable output', false)
    .action((options: { projectRoot: string; state?: string; json: boolean }) => {
      const all = listDecisions(options.projectRoot);
      const filtered =
        options.state !== undefined ? all.filter((d) => d.state === options.state) : all;

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

  command
    .command('extract')
    .description('Run the module-attribution extractor against a prompt; emit JSON candidates')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--prompt <text>', 'Prompt text to analyse')
    .option('--prompt-file <path>', 'Read prompt text from a file')
    .action(async (options: { projectRoot: string; prompt?: string; promptFile?: string }) => {
      const prompt = readPromptArg(options);
      const map = await loadModuleMap(options.projectRoot);
      const existingSlugs = map?.modules.map((m) => m.slug) ?? [];
      const candidates = extractCandidates({ prompt, existingSlugs });
      const needsDecision = candidatesNeedingDecision(candidates);
      console.log(
        JSON.stringify(
          {
            prompt_length: prompt.length,
            existing_slugs: existingSlugs,
            candidates,
            needs_decision: needsDecision,
          },
          null,
          2,
        ),
      );
    });

  command
    .command('infer')
    .description(
      'Run the module-attribution inferencer against a prompt (use when extractor is empty); emit JSON hypotheses',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--prompt <text>', 'Prompt text to analyse')
    .option('--prompt-file <path>', 'Read prompt text from a file')
    .option('--max-choices <n>', 'Cap on existing-module choices', '3')
    .action(
      async (options: {
        projectRoot: string;
        prompt?: string;
        promptFile?: string;
        maxChoices: string;
      }) => {
        const prompt = readPromptArg(options);
        const moduleMap = await loadModuleMap(options.projectRoot);
        const result = inferAttribution({
          prompt,
          moduleMap,
          maxChoices: Number.parseInt(options.maxChoices, 10),
        });
        console.log(JSON.stringify(result, null, 2));
      },
    );

  return command;
}

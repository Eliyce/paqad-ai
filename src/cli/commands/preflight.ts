import { Command } from 'commander';

import { runPreflight } from '@/workflow-preflight/run.js';

export function createPreflightCommand(): Command {
  const command = new Command('preflight')
    .description('Check what a workflow needs before it runs, and list any questions in one place')
    .argument('<workflow>', 'The workflow to check (for example: site-map)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--quiet', 'Suppress the machine-readable summary line', false)
    .action(async (workflow: string, options: { projectRoot: string; quiet: boolean }) => {
      try {
        const result = await runPreflight(options.projectRoot, workflow);
        if (result.ok) {
          console.log(
            `**▸ paqad** · preflight — everything ${workflow} needs is ready. Nothing to ask.`,
          );
        } else {
          console.log(
            `**▸ paqad** · preflight — ${result.questions.length} thing(s) to settle before ${workflow} can run:`,
          );
          for (const question of result.questions) {
            const glyph = question.outcome === 'unavailable' ? '🔴' : '🟡';
            console.log(`> ${glyph} ${question.label} — ${question.why}`);
          }
        }
        if (!options.quiet) {
          console.log(
            JSON.stringify({
              workflow,
              ok: result.ok,
              questions: result.questions,
              requirements: result.requirements.map((requirement) => ({
                id: requirement.id,
                outcome: requirement.outcome,
              })),
            }),
          );
        }
        process.exitCode = result.ok ? 0 : 1;
      } catch (error) {
        console.error(`**▸ paqad** · preflight failed: ${(error as Error).message}`);
        process.exitCode = 2;
      }
    });

  return command;
}

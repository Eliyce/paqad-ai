// `paqad-ai preflight <workflow>` — check everything a workflow needs before it runs, and report
// every unanswered question in one place (issue: site-map rebuild S3a, fixing D5/D6). Read-only:
// it probes requirements (a file exists, a binary answers `--version`) and never executes project
// code that boots the app. Exit codes: 0 when the run may proceed, 1 when there are questions to
// answer first, 2 on an unexpected error.

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

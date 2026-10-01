import { Command } from 'commander';

import { FrameworkError } from '@/core/errors/index.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { createProjectWorkspace } from '@/onboarding/create-project.js';

import { codexTrustHint, printBanner, printNextSteps } from '../ui/banner.js';

/**
 * `paqad-ai new project <name>` (Slice 3) — create a development workspace with an UNDECIDED
 * application stack. The surface mirrors {@link createOnboardCommand}'s options and banners;
 * the behavior is purely additive (it reuses the onboarding orchestrator under the hood).
 */
export function createNewProjectCommand(): Command {
  const newCommand = new Command('new').description('Create something new with paqad-ai');

  newCommand
    .command('project <name>')
    .description('Create a new development workspace (application stack left undecided)')
    .option(
      '--provider <provider...>',
      'Select one or more providers (codex-cli, antigravity, claude-code, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider, aiassistant)',
    )
    .option('--parent-dir <path>', 'Directory to create the workspace in', process.cwd())
    .option('--rag', 'Enable RAG during onboarding (off unless set)')
    .option('--force', 'Overwrite a non-empty directory instead of refusing')
    .action(
      async (
        name: string,
        options: {
          provider?: AdapterType[];
          parentDir: string;
          rag?: boolean;
          force?: boolean;
        },
      ) => {
        printBanner();

        try {
          const result = await createProjectWorkspace({
            name,
            parentDir: options.parentDir,
            providers: options.provider,
            // Only forward a RAG choice when the owner stated one; otherwise leave it off.
            rag: options.rag === undefined ? undefined : { enabled: options.rag },
            force: options.force,
          });

          printNextSteps();

          console.log(
            `\nWorkspace created at ${result.projectRoot}` +
              (result.gitInitialized ? ' (git initialized).' : '.'),
          );
          console.log(
            'Application stack: UNDECIDED — no language or framework was selected, and no ' +
              'framework default commands were written.',
          );
          console.log(
            'NEXT STEP: choose an application stack (run discovery, or `paqad-ai onboard` once ' +
              'the stack exists) before building application code.',
          );

          if (result.recovery) {
            console.warn(`\n⚠ ${result.recovery}`);
          }

          const codexHint = codexTrustHint(options.provider);
          if (codexHint) {
            console.log(`\n${codexHint}`);
          }
        } catch (error) {
          if (error instanceof FrameworkError && error.code === 'PROJECT_DIR_NOT_EMPTY') {
            console.error(`\n✖ ${error.message}`);
            process.exitCode = 1;
            return;
          }
          throw error;
        }
      },
    );

  return newCommand;
}

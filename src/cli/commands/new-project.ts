import { Command } from 'commander';

import { FrameworkError } from '@/core/errors/index.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { createProjectWorkspace } from '@/onboarding/create-project.js';

import { codexTrustHint, printBanner, printNewProjectNextSteps } from '../ui/banner.js';

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
            rag: options.rag === undefined ? undefined : { enabled: options.rag },
            force: options.force,
          });

          printNewProjectNextSteps({
            projectRoot: result.projectRoot,
            gitInitialized: result.gitInitialized,
          });

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

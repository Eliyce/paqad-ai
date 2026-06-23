import { Command } from 'commander';

import { setFrameworkEnabled } from '@/core/framework-enabled.js';

export function createDisableCommand(): Command {
  return new Command('disable')
    .description(
      'Disable paqad for this project (vanilla mode) — gates, hooks, and the verification backstop become a no-op until re-enabled',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      try {
        const result = setFrameworkEnabled(options.projectRoot, false);
        console.log(
          JSON.stringify(
            {
              ...result,
              message:
                'paqad disabled (vanilla mode). Re-enable with `paqad-ai enable`. Tip: set PAQAD_DISABLED=1 for a per-run override without editing tracked files.',
            },
            null,
            2,
          ),
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

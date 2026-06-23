import { Command } from 'commander';

import { setFrameworkEnabled } from '@/core/framework-enabled.js';

export function createEnableCommand(): Command {
  return new Command('enable')
    .description(
      'Re-enable paqad for this project — restores full framework behavior with no re-onboarding',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      try {
        const result = setFrameworkEnabled(options.projectRoot, true);
        console.log(
          JSON.stringify(
            {
              ...result,
              message:
                'paqad enabled. Note: a PAQAD_DISABLED=1 environment override, if set, still forces vanilla mode for that run.',
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

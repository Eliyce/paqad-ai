import { Command } from 'commander';

import type { AdapterType } from '@/core/types/adapter.js';
import type { Capability, Stack } from '@/core/types/domain.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';

import { printBanner, printNextSteps } from '../ui/banner.js';

export function createOnboardCommand(): Command {
  return new Command('onboard')
    .description('Full project onboarding')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--stack <stack>', 'Force the target stack')
    .option('--capability <capability...>', 'Add one or more capabilities')
    .option(
      '--providers <provider...>',
      'Select one or more providers (codex-cli, antigravity, claude-code, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider)',
    )
    .action(
      async (options: {
        projectRoot: string;
        stack?: Stack;
        capability?: Capability[];
        providers?: AdapterType[];
      }) => {
        printBanner();

        const orchestrator = new OnboardingOrchestrator();
        const result = await orchestrator.run({
          projectRoot: options.projectRoot,
          selections:
            options.stack || options.capability || options.providers
              ? {
                  stack: options.stack,
                  capabilities: options.capability,
                  providers: options.providers,
                }
              : undefined,
          // Print the success banner as soon as the project is fully written to disk.
          // The optional RAG phase runs after this and cannot drop core onboarding state
          // even if it prompts, hangs, or fails. See #62.
          onPhase1Complete: () => {
            printNextSteps();
          },
        });

        // No-migration safety net: if a legacy fat profile carried non-default
        // framework values, the hard-cutover strip just reverted them to code
        // defaults. Print a one-time, prominent notice so the revert is never
        // silent. A clean onboard reverts nothing, so this stays quiet.
        const reverted = result?.reverted_framework_values ?? [];
        if (reverted.length > 0) {
          console.warn(
            `\n⚠ Framework settings now live in the .config layer. These non-default values in ` +
              `project-profile.yaml were not migrated and now use code defaults until you set them ` +
              `in .paqad/configs/.config.* or .paqad/.config:\n    ${reverted.join('\n    ')}\n` +
              `  See the .paqad/configs/ files (every option is listed there, commented out).`,
          );
        }
      },
    );
}

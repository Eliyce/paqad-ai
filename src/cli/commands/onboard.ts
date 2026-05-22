import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
        await orchestrator.run({
          projectRoot: options.projectRoot,
          selections:
            options.stack || options.capability || options.providers
              ? {
                  stack: options.stack,
                  capabilities: options.capability,
                  providers: options.providers,
                }
              : undefined,
        });

        printNextSteps();
        writeNextStepsFile(options.projectRoot);
      },
    );
}

function writeNextStepsFile(projectRoot: string): void {
  const paqadDir = join(projectRoot, '.paqad');
  mkdirSync(paqadDir, { recursive: true });
  writeFileSync(
    join(paqadDir, 'next-steps.md'),
    [
      '## Required: Create Documentation Foundation',
      '',
      'Before starting feature work, prompt your AI agent with:',
      '',
      '```text',
      'create documentation',
      '```',
      '',
      'This generates:',
      '- `docs/instructions/**`',
      '- `docs/instructions/rules/module-map.yml`',
      '',
      'Review `docs/instructions/rules/module-map.yml` first. Confirm that module and feature names use business language, then prompt your AI agent with:',
      '',
      '```text',
      'create module documentation',
      '```',
      '',
      'That second prompt generates `docs/modules/**` from the reviewed module map.',
    ].join('\n'),
    'utf8',
  );
}

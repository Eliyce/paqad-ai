import { Command } from 'commander';

import { isNpmAvailable } from '@/core/npm-available.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { STACKS, type Capability, type Stack } from '@/core/types/domain.js';
import { Detector } from '@/detection/detector.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';

import { codexTrustHint, printBanner, printNextSteps } from '../ui/banner.js';

interface OnboardOptions {
  projectRoot: string;
  stack?: Stack;
  capability?: Capability[];
  providers?: AdapterType[];
  rag?: string;
  detect?: boolean;
  json?: boolean;
  nonInteractive?: boolean;
}

function firstMissingNonInteractiveFlag(
  options: OnboardOptions,
  npmAvailable: boolean,
): string | null {
  if (npmAvailable && (!options.providers || options.providers.length === 0)) return '--providers';
  if (!options.stack) return '--stack';
  if (!options.capability || options.capability.length === 0) return '--capability';
  return null;
}

export function createOnboardCommand(): Command {
  return new Command('onboard')
    .description('Full project onboarding')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--stack <stack>', 'Force the target stack')
    .option('--capability <capability...>', 'Add one or more capabilities')
    .option(
      '--providers <provider...>',
      'Select one or more providers (codex-cli, antigravity, claude-code, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider, aiassistant)',
    )
    .option('--rag <on|off>', 'Force RAG on or off, skipping the interactive RAG prompt')
    .option('--detect', 'Detect the stack and suggested capabilities without writing anything')
    .option('--json', 'With --detect, print the detection as JSON')
    .option(
      '--non-interactive',
      'Never prompt; requires the selection flags (exit 2 with `missing --<flag>` when one is absent and stdin is not a TTY)',
    )
    .action(async (options: OnboardOptions) => {
      if (options.detect) {
        const detection = await new Detector().detect(options.projectRoot);
        const report = {
          detected_domain: detection.detected_domain,
          detected_stack: detection.detected_stack,
          detected_capabilities: detection.detected_capabilities,
          recommended_capabilities: detection.recommended_capabilities ?? [],
          confidence: detection.confidence,
        };
        if (options.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          printBanner();
          process.stdout.write(
            `Detected: ${report.detected_domain ?? 'unknown'} / ${report.detected_stack ?? 'none'} (${report.confidence} confidence)\n`,
          );
          process.stdout.write(
            `Suggested capabilities: ${report.detected_capabilities.join(', ') || 'none'}\n`,
          );
        }
        return;
      }

      if (options.stack && !(STACKS as readonly string[]).includes(options.stack)) {
        process.stderr.write(
          `unknown stack "${options.stack}". Valid stacks: ${STACKS.join(', ')}\n`,
        );
        process.exitCode = 2;
        return;
      }

      const npmAvailable = isNpmAvailable();

      if (options.nonInteractive) {
        const missing = firstMissingNonInteractiveFlag(options, npmAvailable);
        if (missing && !process.stdin.isTTY) {
          process.stderr.write(`missing ${missing}\n`);
          process.exitCode = 2;
          return;
        }
      }

      let providers = options.providers;
      if (!npmAvailable) {
        if (providers && providers.some((p) => p !== 'claude-code')) {
          process.stderr.write(
            'npm is not available, so only `--providers claude-code` can be wired without it.\n',
          );
          process.exitCode = 2;
          return;
        }
        providers = ['claude-code'];
      }

      printBanner();

      const rag =
        options.rag === 'on'
          ? { enabled: true }
          : options.rag === 'off'
            ? { enabled: false }
            : options.nonInteractive
              ? { enabled: false }
              : undefined;

      const hasSelections = Boolean(
        options.stack || options.capability || providers || rag !== undefined,
      );

      const orchestrator = new OnboardingOrchestrator();
      const result = await orchestrator.run({
        projectRoot: options.projectRoot,
        selections: hasSelections
          ? {
              stack: options.stack,
              capabilities: options.capability,
              providers,
              rag,
            }
          : undefined,
        onPhase1Complete: () => {
          printNextSteps();
        },
      });

      const reverted = result?.reverted_framework_values ?? [];
      if (reverted.length > 0) {
        console.warn(
          `\n⚠ Framework settings now live in the .config layer. These non-default values in ` +
            `project-profile.yaml were not migrated and now use code defaults until you set them ` +
            `in .paqad/configs/.config.* or .paqad/.config:\n    ${reverted.join('\n    ')}\n` +
            `  See the .paqad/configs/ files (every option is listed there, commented out).`,
        );
      }

      const codexHint = codexTrustHint(result?.decision_pause_supported_adapters);
      if (codexHint) {
        console.log(`\n${codexHint}`);
      }
    });
}

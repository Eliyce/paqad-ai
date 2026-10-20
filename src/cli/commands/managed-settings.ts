import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { PAQAD_MUTATING_TOOL_MATCHER } from '@/adapters/shared/paqad-hooks.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { pluginSettingsKeys } from '@/install/plugin-migration.js';

export const MANAGED_SETTINGS_FILE = 'paqad.json';

export const MANAGED_SETTINGS_REFUSAL =
  'managed-settings is part of paqad for teams; set enterprise.enabled=true';

export const MANAGED_HOOK_TIMEOUT_SEC = 30;

export const MANAGED_HOOK_COMMANDS: readonly string[] = [
  'paqad-ai hook --managed capability-gate pre-mutation',
  'paqad-ai hook --managed decision-pause-gate',
];

export function buildManagedSettings(options: { plugin: boolean }): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    hooks: {
      PreToolUse: [
        {
          matcher: PAQAD_MUTATING_TOOL_MATCHER,
          hooks: MANAGED_HOOK_COMMANDS.map((command) => ({
            type: 'command',
            command,
            onFailure: 'block',
            timeout: MANAGED_HOOK_TIMEOUT_SEC,
          })),
        },
      ],
    },
  };
  return options.plugin ? { ...settings, ...pluginSettingsKeys() } : settings;
}

interface ManagedSettingsOptions {
  projectRoot: string;
  write?: string;
  plugin: boolean;
}

export function createManagedSettingsCommand(): Command {
  return new Command('managed-settings')
    .description('Print or write the Claude Code managed settings that enforce paqad org-wide')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--write <dir>', 'write <dir>/paqad.json instead of printing')
    .option('--no-plugin', 'leave out the paqad plugin marketplace and enablement keys')
    .action((options: ManagedSettingsOptions) => {
      if (!resolveFrameworkConfig(options.projectRoot).enterprise.enabled) {
        console.error(MANAGED_SETTINGS_REFUSAL);
        process.exitCode = 1;
        return;
      }
      const body = `${JSON.stringify(buildManagedSettings({ plugin: options.plugin }), null, 2)}\n`;
      if (options.write === undefined) {
        process.stdout.write(body);
        return;
      }
      const target = join(options.write, MANAGED_SETTINGS_FILE);
      try {
        mkdirSync(options.write, { recursive: true });
        writeFileSync(target, body);
      } catch (error) {
        console.error(
          `could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`**▸ paqad** · wrote the managed settings to ${target}`);
    });
}

import { Command } from 'commander';

import { VERSION } from '@/index.js';

import { createAuditCommand } from './commands/audit.js';
import { createCapabilitiesCommand } from './commands/capabilities.js';
import { createChecksCommand } from './commands/checks.js';
import { createComplianceCommand } from './commands/compliance.js';
import { createDashboardCommand } from './commands/dashboard.js';
import { createDisableCommand } from './commands/disable.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createEnableCommand } from './commands/enable.js';
import { createEvidenceCommand } from './commands/evidence.js';
import { createGraphCommand } from './commands/graph.js';
import { createInstallCommand } from './commands/install.js';
import { createModuleDecisionsCommand } from './commands/module-decisions.js';
import { createModuleEventsCommand } from './commands/module-events.js';
import { createModuleHealthCommand } from './commands/module-health.js';
import { createModuleMapCommand } from './commands/module-map.js';
import { createOnboardCommand } from './commands/onboard.js';
import { createPatternsCommand } from './commands/patterns.js';
import { createPacksCommand } from './commands/packs.js';
import { createRagCommand } from './commands/rag.js';
import { createRagEvidenceCommand } from './commands/rag-evidence.js';
import { createRefreshCommand } from './commands/refresh.js';
import { createRulesCommand } from './commands/rules.js';
import { createSpecCommand } from './commands/spec.js';
import { createStageCommand } from './commands/stage.js';
import { createStatusCommand } from './commands/status.js';
import { createUpdateCommand } from './commands/update.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('paqad-ai')
    .description('AI Agency Framework for software agencies')
    .version(VERSION)
    .showSuggestionAfterError(true);

  program.addCommand(createInstallCommand());
  program.addCommand(createCapabilitiesCommand());
  program.addCommand(createChecksCommand());
  program.addCommand(createPacksCommand());
  program.addCommand(createComplianceCommand());
  program.addCommand(createDashboardCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createEvidenceCommand());
  program.addCommand(createAuditCommand());
  // Hidden deprecated alias (issue #159): the graph is now a dashboard area.
  program.addCommand(createGraphCommand(), { hidden: true });
  program.addCommand(createModuleDecisionsCommand());
  program.addCommand(createModuleEventsCommand());
  program.addCommand(createModuleHealthCommand());
  program.addCommand(createModuleMapCommand());
  program.addCommand(createOnboardCommand());
  program.addCommand(createEnableCommand());
  program.addCommand(createDisableCommand());
  program.addCommand(createRefreshCommand());
  program.addCommand(createRulesCommand());
  program.addCommand(createRagCommand());
  program.addCommand(createRagEvidenceCommand());
  program.addCommand(createUpdateCommand());
  program.addCommand(createPatternsCommand());
  program.addCommand(createSpecCommand());
  program.addCommand(createStageCommand());
  program.addCommand(createStatusCommand());

  return program;
}

const COMPAT_OPTION_ALIASES: Record<string, Record<string, string>> = {
  onboard: {
    '--provider': '--providers',
  },
};

type ArgvNormalizationResult = {
  argv: string[];
  notices: string[];
};

export function normalizeCliArgv(program: Command, argv: string[]): ArgvNormalizationResult {
  if (argv.length <= 2) {
    return { argv, notices: [] };
  }

  const normalized = argv.slice(0, 2);
  const notices: string[] = [];
  const tokens = argv.slice(2);

  let current = program;
  let positionalCount = 0;
  let pendingValueOption:
    | {
        variadic: boolean;
      }
    | undefined;
  let passthrough = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (passthrough) {
      normalized.push(token);
      continue;
    }

    if (pendingValueOption) {
      if (looksLikeOption(token)) {
        pendingValueOption = undefined;
      } else {
        normalized.push(token);

        if (!pendingValueOption.variadic) {
          pendingValueOption = undefined;
        }

        continue;
      }
    }

    if (token === '--') {
      normalized.push(token);
      passthrough = true;
      pendingValueOption = undefined;
      continue;
    }

    const subcommand = findSubcommand(current, token);
    if (subcommand) {
      normalized.push(token);
      current = subcommand;
      positionalCount = 0;
      pendingValueOption = undefined;
      continue;
    }

    if (looksLikeOption(token)) {
      const resolved = resolveKnownOption(current, token);
      if (resolved) {
        normalized.push(resolved.token);

        if (resolved.notice) {
          notices.push(resolved.notice);
        }

        if (resolved.option.required || resolved.option.optional) {
          const inlineValue = extractInlineOptionValue(resolved.token);
          if (inlineValue === undefined) {
            pendingValueOption = { variadic: resolved.option.variadic };
          }
        }

        continue;
      }

      notices.push(
        `warning: ignoring unsupported option '${extractOptionName(token)}' for command '${getCommandPath(current)}'`,
      );

      if (shouldDiscardNextTokenAsUnknownValue(current, positionalCount, tokens[index + 1])) {
        index += 1;
      }

      continue;
    }

    normalized.push(token);
    positionalCount += 1;
  }

  return { argv: normalized, notices };
}

function resolveKnownOption(
  command: Command,
  token: string,
): { option: Command['options'][number]; token: string; notice?: string } | undefined {
  const originalName = extractOptionName(token);
  if (originalName === '--help' || originalName === '-h') {
    return {
      option: {
        long: '--help',
        short: '-h',
        required: false,
        optional: false,
        variadic: false,
      } as Command['options'][number],
      token,
    };
  }

  const path = getCommandPath(command);
  const alias = COMPAT_OPTION_ALIASES[path]?.[originalName];
  const resolvedToken = alias ? replaceOptionName(token, alias) : token;
  const resolvedName = extractOptionName(resolvedToken);
  const option = command.options.find((candidate) => {
    return candidate.long === resolvedName || candidate.short === resolvedName;
  });

  if (!option) {
    return undefined;
  }

  return {
    option,
    token: resolvedToken,
    notice: alias
      ? `warning: treating '${originalName}' as '${resolvedName}' for command '${path}'`
      : undefined,
  };
}

function getCommandPath(command: Command): string {
  const path: string[] = [];
  let current: Command | null = command;

  while (current) {
    if (current.parent) {
      path.unshift(current.name());
    }
    current = current.parent ?? null;
  }

  return path.join(' ');
}

function findSubcommand(command: Command, token: string): Command | undefined {
  return command.commands.find((candidate) => {
    return candidate.name() === token || candidate.aliases().includes(token);
  });
}

function looksLikeOption(token: string): boolean {
  return token.startsWith('-') && token !== '-';
}

function extractOptionName(token: string): string {
  const separatorIndex = token.indexOf('=');
  return separatorIndex === -1 ? token : token.slice(0, separatorIndex);
}

function extractInlineOptionValue(token: string): string | undefined {
  const separatorIndex = token.indexOf('=');
  return separatorIndex === -1 ? undefined : token.slice(separatorIndex + 1);
}

function replaceOptionName(token: string, nextName: string): string {
  const inlineValue = extractInlineOptionValue(token);
  return inlineValue === undefined ? nextName : `${nextName}=${inlineValue}`;
}

function shouldDiscardNextTokenAsUnknownValue(
  command: Command,
  positionalCount: number,
  nextToken: string | undefined,
): boolean {
  if (nextToken === undefined || looksLikeOption(nextToken) || findSubcommand(command, nextToken)) {
    return false;
  }

  return !commandExpectsMoreArguments(command, positionalCount);
}

function commandExpectsMoreArguments(command: Command, positionalCount: number): boolean {
  const registeredArguments = command.registeredArguments;
  if (registeredArguments.length === 0) {
    return false;
  }

  return registeredArguments.some((argument, index) => {
    return argument.variadic || index >= positionalCount;
  });
}

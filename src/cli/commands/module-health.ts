import { Command } from 'commander';

import {
  createEvidence,
  persistEvidence,
  syncModuleHealth,
  type ModuleHealthEvidence,
} from '@/planning/module-health-updater.js';

export function createModuleHealthCommand(): Command {
  const command = new Command('module-health').description('Maintain module health ledgers');

  command
    .command('sync')
    .description('Sync pending module health evidence into profiles')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--provider <provider>', 'Provider adapter identifier')
    .option('--session-id <id>', 'Provider session identifier')
    .option('--source <source>', 'Evidence source', 'provider-hook')
    .option('--silent', 'Suppress normal output', false)
    .option('--preflight', 'Run as a bounded classification preflight', false)
    .action(
      async (options: {
        projectRoot: string;
        provider?: string;
        sessionId?: string;
        source: ModuleHealthEvidence['source'];
        silent: boolean;
        preflight: boolean;
      }) => {
        const result = await syncModuleHealth({
          projectRoot: options.projectRoot,
          provider: options.provider,
          sessionId: options.sessionId,
          source: options.source,
          silent: options.silent,
          preflight: options.preflight,
        });
        if (!options.silent) {
          console.log(JSON.stringify(result, null, 2));
        }
        process.exitCode = 0;
      },
    );

  command
    .command('record')
    .description('Record normalized module health evidence')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--provider <provider>', 'Provider adapter identifier')
    .option('--session-id <id>', 'Provider session identifier')
    .option('--source <source>', 'Evidence source', 'provider-hook')
    .option('--file <path...>', 'Affected file path')
    .option('--module <module...>', 'Affected module name')
    .option('--verification-status <status>', 'Verification status')
    .option('--coverage <pct>', 'Coverage percentage')
    .option('--failed-tests <count>', 'Failed test count')
    .option('--silent', 'Suppress normal output', false)
    .action(
      async (options: {
        projectRoot: string;
        provider?: string;
        sessionId?: string;
        source: ModuleHealthEvidence['source'];
        file?: string[];
        module?: string[];
        verificationStatus?: 'pass' | 'fail' | 'partial' | 'unknown';
        coverage?: string;
        failedTests?: string;
        silent: boolean;
      }) => {
        const failed = parseOptionalInteger(options.failedTests);
        const coverage = parseOptionalNumber(options.coverage);
        const event = createEvidence({
          source: options.source,
          provider: options.provider,
          sessionId: options.sessionId,
          affectedFiles: options.file ?? [],
          affectedModules: options.module ?? [],
          signals: {
            tests:
              coverage !== undefined || failed !== undefined
                ? {
                    status: failed && failed > 0 ? 'fail' : options.verificationStatus,
                    ...(coverage !== undefined ? { coverage_pct: coverage } : {}),
                    ...(failed !== undefined ? { failed } : {}),
                  }
                : undefined,
            verification: options.verificationStatus
              ? {
                  status: options.verificationStatus,
                  gates_failed: options.verificationStatus === 'fail' ? ['manual-record'] : [],
                  gates_passed: options.verificationStatus === 'pass' ? ['manual-record'] : [],
                }
              : undefined,
          },
        });
        await persistEvidence(options.projectRoot, event);
        if (!options.silent) {
          console.log(JSON.stringify(event, null, 2));
        }
      },
    );

  return command;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  const parsed = parseOptionalNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

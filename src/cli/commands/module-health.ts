import { Command } from 'commander';

import { discoverModuleHealth } from '@/module-map/source-roots.js';
import { rollupModuleHealth } from '@/module-health/rollup.js';
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
    .option(
      '--from-report <path>',
      'Run the test-driven rollup using <path> as the coverage report instead of replaying evidence.',
    )
    .option(
      '--from-test-report <path>',
      'Run the test-driven rollup using <path> as the test report (junit-xml / go-json / vitest-json).',
    )
    .action(
      async (options: {
        projectRoot: string;
        provider?: string;
        sessionId?: string;
        source: ModuleHealthEvidence['source'];
        silent: boolean;
        preflight: boolean;
        fromReport?: string;
        fromTestReport?: string;
      }) => {
        // Issue #80 Phase 3 (spec AC #25): --from-report routes through the
        // test-driven rollup engine instead of the session-evidence pipeline.
        // The two paths are deliberately separate — session evidence carries
        // diff context, rollup carries report context; mixing them would
        // collapse two distinct signals onto one profile.
        if (options.fromReport || options.fromTestReport) {
          const discovered = discoverModuleHealth(options.projectRoot);
          const report = await rollupModuleHealth({
            projectRoot: options.projectRoot,
            moduleHealth: discovered.module_health,
            coverageReportPath: options.fromReport,
            testReportPath: options.fromTestReport,
          });
          if (!options.silent) {
            console.log(JSON.stringify(report, null, 2));
          }
          process.exitCode = report.blocked === null ? 0 : 1;
          return;
        }

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

  // Issue #80 Phase 3 (spec AC #22-#26) — paqad-ai module-health rollup runs
  // the test-driven rollup engine using the active stack pack's
  // module_health.{coverage,test_report}_{format,path}.
  command
    .command('rollup')
    .description(
      "Run the test-driven module-health rollup using the active pack's module_health block",
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--from-report <path>', 'Override coverage report path')
    .option('--from-test-report <path>', 'Override test report path')
    .option('--silent', 'Suppress normal output', false)
    .action(
      async (options: {
        projectRoot: string;
        fromReport?: string;
        fromTestReport?: string;
        silent: boolean;
      }) => {
        const discovered = discoverModuleHealth(options.projectRoot);
        const report = await rollupModuleHealth({
          projectRoot: options.projectRoot,
          moduleHealth: discovered.module_health,
          coverageReportPath: options.fromReport,
          testReportPath: options.fromTestReport,
        });
        if (!options.silent) {
          console.log(JSON.stringify(report, null, 2));
        }
        process.exitCode = report.blocked === null ? 0 : 1;
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

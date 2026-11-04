import { Command } from 'commander';

import { maybeMigrateToPlugin, runClaudeInstallWith } from '@/install/plugin-migration.js';
import { appendAuditLog, appendAuditLogFailure } from '@/update/audit.js';
import { FrameworkUpdater, type UpdateReport } from '@/update/index.js';
import {
  allChangedFiles,
  readLastUpdateRecord,
  writeLastUpdateRecord,
  type LastUpdateRecord,
} from '@/update/last-update.js';
import { VERSION } from '@/index.js';

interface UpdateOptions {
  projectRoot: string;
  silent?: boolean;
  json?: boolean;
  last?: boolean;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

type UpdateSummaryInput = Pick<
  UpdateReport,
  'previous_version' | 'target_version' | 'regenerated' | 'changed_files' | 'config_keys_pruned'
> & {
  skipped: readonly unknown[];
  team_setup_notes?: readonly string[];
  git_workflow_notes?: readonly string[];
};

const MANUAL_DETAILS_COMMAND = 'paqad-ai update --json';
const LAST_DETAILS_COMMAND = 'paqad-ai update --last --json';

function versionLine(report: UpdateSummaryInput): string {
  const { previous_version: previous, target_version: target } = report;
  if (previous === target) return `paqad is already on ${target}.`;
  return previous === null
    ? `Updated paqad to ${target}.`
    : `Updated paqad from ${previous} to ${target}.`;
}

export function formatUpdateSummary(
  report: UpdateSummaryInput,
  detailsCommand: string = MANUAL_DETAILS_COMMAND,
): string[] {
  const lines = [versionLine(report)];
  const changed = allChangedFiles(report);
  if (changed.length === 0) {
    lines.push('No files needed changing.');
  } else {
    lines.push(`Changed ${countOf(changed.length, 'file')}:`);
    lines.push(...changed.map((path) => `  ${path}`));
  }
  if (report.skipped.length > 0) {
    const pronoun = report.skipped.length === 1 ? 'it' : 'them';
    lines.push(
      `Kept ${countOf(report.skipped.length, 'file')} paqad would write differently. Run ${detailsCommand} to see ${pronoun}.`,
    );
  }
  if (report.config_keys_pruned.length > 0) {
    lines.push(
      `Removed ${countOf(report.config_keys_pruned.length, 'setting')} paqad no longer has: ${report.config_keys_pruned.join(', ')}.`,
    );
  }
  return lines;
}

export function formatUpdateReportLines(
  report: UpdateSummaryInput,
  detailsCommand: string = MANUAL_DETAILS_COMMAND,
): string[] {
  return [
    ...formatUpdateSummary(report, detailsCommand),
    ...(report.team_setup_notes ?? []),
    ...(report.git_workflow_notes ?? []),
  ];
}

function recordAsSummary(record: LastUpdateRecord): UpdateSummaryInput {
  return { ...record, regenerated: record.changed_files };
}

function printLastUpdate(projectRoot: string, json: boolean): void {
  const record = readLastUpdateRecord(projectRoot);
  if (json) {
    console.log(JSON.stringify(record ?? { last_update: null }, null, 2));
    return;
  }
  if (record === null) {
    console.log('No background update to report.');
    return;
  }
  for (const line of formatUpdateReportLines(recordAsSummary(record), LAST_DETAILS_COMMAND)) {
    console.log(line);
  }
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update framework-managed artifacts')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress output; write results to audit log only')
    .option('--json', 'Print the full report as JSON instead of the summary')
    .option('--last', 'Show what the last background update did, without updating')
    .action(async (options: UpdateOptions) => {
      if (options.last) {
        printLastUpdate(options.projectRoot, options.json === true);
        return;
      }
      try {
        const report = await new FrameworkUpdater().run(options.projectRoot);
        if (!options.silent) {
          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            for (const line of formatUpdateReportLines(report)) console.log(line);
          }
        }
        if (options.silent) writeLastUpdateRecord(options.projectRoot, report);
        appendAuditLog(options.projectRoot, report.previous_version, report.target_version);
        if (options.silent) {
          try {
            maybeMigrateToPlugin(options.projectRoot, {
              runClaudeInstall: runClaudeInstallWith,
            });
          } catch {}
        }
      } catch (err) {
        if (!options.silent) {
          throw err;
        }
        appendAuditLogFailure(
          options.projectRoot,
          null,
          VERSION,
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });
}

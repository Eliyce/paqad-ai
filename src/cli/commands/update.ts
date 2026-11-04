import { Command } from 'commander';

import { maybeMigrateToPlugin, runClaudeInstallWith } from '@/install/plugin-migration.js';
import { appendAuditLog, appendAuditLogFailure } from '@/update/audit.js';
import { FrameworkUpdater, type UpdateReport } from '@/update/index.js';
import { VERSION } from '@/index.js';

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function versionLine(report: UpdateReport): string {
  const { previous_version: previous, target_version: target } = report;
  if (previous === target) return `paqad is already on ${target}.`;
  return previous === null
    ? `Updated paqad to ${target}.`
    : `Updated paqad from ${previous} to ${target}.`;
}

export function formatUpdateSummary(report: UpdateReport): string[] {
  const lines = [versionLine(report)];
  if (report.regenerated.length === 0) {
    lines.push('No files needed changing.');
  } else {
    lines.push(`Changed ${countOf(report.regenerated.length, 'file')}:`);
    lines.push(...report.regenerated.map((path) => `  ${path}`));
  }
  if (report.skipped.length > 0) {
    const pronoun = report.skipped.length === 1 ? 'it' : 'them';
    lines.push(
      `Kept ${countOf(report.skipped.length, 'file')} paqad would write differently. Run paqad-ai update --json to see ${pronoun}.`,
    );
  }
  if (report.config_keys_pruned.length > 0) {
    lines.push(
      `Removed ${countOf(report.config_keys_pruned.length, 'setting')} paqad no longer has: ${report.config_keys_pruned.join(', ')}.`,
    );
  }
  return lines;
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update framework-managed artifacts')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress output; write results to audit log only')
    .option('--json', 'Print the full report as JSON instead of the summary')
    .action(async (options: { projectRoot: string; silent?: boolean; json?: boolean }) => {
      try {
        const report = await new FrameworkUpdater().run(options.projectRoot);
        if (!options.silent) {
          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            for (const line of formatUpdateSummary(report)) console.log(line);
            for (const note of report.team_setup_notes ?? []) console.log(note);
            for (const note of report.git_workflow_notes ?? []) console.log(note);
          }
        }
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

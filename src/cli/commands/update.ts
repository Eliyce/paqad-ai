import { Command } from 'commander';

import { maybeMigrateToPlugin, runClaudeInstallWith } from '@/install/plugin-migration.js';
import { appendAuditLog, appendAuditLogFailure } from '@/update/audit.js';
import { FrameworkUpdater } from '@/update/index.js';
import { VERSION } from '@/index.js';

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update framework-managed artifacts')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress output; write results to audit log only')
    .action(async (options: { projectRoot: string; silent?: boolean }) => {
      try {
        const report = await new FrameworkUpdater().run(options.projectRoot);
        if (!options.silent) {
          console.log(JSON.stringify(report, null, 2));
        }
        appendAuditLog(options.projectRoot, report.previous_version, report.target_version);
        if (options.silent) {
          try {
            maybeMigrateToPlugin(options.projectRoot, {
              runClaudeInstall: runClaudeInstallWith,
            });
          } catch {
            /* best-effort: the migration never breaks the update */
          }
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

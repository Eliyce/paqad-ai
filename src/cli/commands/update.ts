import { Command } from 'commander';

import {
  maybeMigrateToPlugin,
  runClaudePluginInstall,
  runClaudePluginUninstall,
} from '@/install/plugin-migration.js';
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
        // Issue #621 — at the end of the background self-update, best-effort move npm Claude Code
        // users to the plugin. OFF by default; never throws, blocks, or prints in a session.
        if (options.silent) {
          try {
            maybeMigrateToPlugin(options.projectRoot, {
              runClaudeInstall: runClaudePluginInstall,
              runClaudeUninstall: runClaudePluginUninstall,
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

import { Command } from 'commander';

import {
  recordMigrationSession,
  rollbackPlugin,
  runClaudePluginUninstall,
} from '@/install/plugin-migration.js';

/**
 * `paqad-ai plugin …` — manage the Claude Code plugin migration (issue #621).
 *
 * `rollback` undoes an automatic npm→plugin move on this machine, pins the project back to the
 * npm setup (`claude_install_mode=settings`) so it never re-migrates, and prints the documented
 * confirmation line. The npm package keeps working, so paqad never goes down.
 *
 * `tick` (hidden, issue #648) is spawned detached by the SessionStart hooks to record one real
 * Claude Code session against the migration. It prints nothing.
 */
export function createPluginCommand(): Command {
  const command = new Command('plugin').description('Manage the Claude Code plugin migration');

  command
    .command('rollback')
    .description('Move this machine back to the npm setup in Claude Code and stop re-migrating')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      const message = rollbackPlugin(options.projectRoot, {
        runClaudeUninstall: runClaudePluginUninstall,
      });
      console.log(message);
    });

  command
    .command('tick', { hidden: true })
    .description('Record one Claude Code session against the plugin migration (used by hooks)')
    .requiredOption('--source <source>', 'Which copy ran the session: npm or plugin')
    .option('--session <id>', 'The Claude Code session id')
    .action(async (options: { source: string; session?: string }) => {
      if (options.source !== 'npm' && options.source !== 'plugin') return;
      await recordMigrationSession(
        { source: options.source, sessionId: options.session },
        { runClaudeUninstall: runClaudePluginUninstall },
      );
    });

  return command;
}

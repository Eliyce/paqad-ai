import { Command } from 'commander';

import {
  recordMigrationSession,
  rollbackPlugin,
  runClaudePluginUninstall,
} from '@/install/plugin-migration.js';

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

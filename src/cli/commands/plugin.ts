import { Command } from 'commander';

import { rollbackPlugin, runClaudePluginUninstall } from '@/install/plugin-migration.js';

/**
 * `paqad-ai plugin …` — manage the Claude Code plugin migration (issue #621).
 *
 * `rollback` undoes an automatic npm→plugin move on this machine, pins the project back to the
 * npm setup (`claude_install_mode=settings`) so it never re-migrates, and prints the documented
 * confirmation line. The npm package keeps working, so paqad never goes down.
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

  return command;
}

import { Command } from 'commander';

import { resumePlanExecution } from '@/cli/plan-resume.js';

export function createPlanCommand(): Command {
  const command = new Command('plan').description('Manage planning manifest execution');

  command
    .command('resume <slug>')
    .description('Resume slice execution from the last incomplete slice')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (slug: string, options: { projectRoot: string }) => {
      const result = await resumePlanExecution(options.projectRoot, slug);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 0;
    });

  return command;
}

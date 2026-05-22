import { Command } from 'commander';

import { bootstrapFramework } from '@/install/index.js';

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Bootstrap the framework into the current project')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: { projectRoot: string }) => {
      const result = bootstrapFramework(options.projectRoot);
      console.log(JSON.stringify(result, null, 2));
    });
}

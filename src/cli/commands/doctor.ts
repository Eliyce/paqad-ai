import { Command } from 'commander';

import { HealthChecker } from '@/health/index.js';

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check framework health and suggest fixes')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action(async (options: { projectRoot: string }) => {
      const report = await new HealthChecker().run(options.projectRoot);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.overall_status === 'fail' ? 1 : 0;
    });
}

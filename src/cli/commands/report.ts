import { Command } from 'commander';

import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';
import {
  SpeedReportInputError,
  buildSpeedReport,
  renderSpeedReport,
} from '@/speed-report/report.js';

interface SpeedOptions {
  projectRoot: string;
  change?: string;
  since?: string;
  json: boolean;
  transcriptsRoot?: string;
}

export function createReportCommand(): Command {
  const command = new Command('report').description(
    'Read-only reports built from the change ledger and the session transcripts',
  );

  command
    .command('speed')
    .description('Show where each change’s time went: busy, stage owners, owner wait, edit gate')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--change <id>', 'Report one change (ULID, issue number or bundle name)')
    .option('--since <date>', 'Only changes whose window starts on or after this UTC date')
    .option('--json', 'Emit the machine-readable report', false)
    .option(
      '--transcripts-root <dir>',
      'Claude Code transcripts folder (default: <CLAUDE_CONFIG_DIR or ~/.claude>/projects)',
    )
    .action((options: SpeedOptions) => {
      if (isFrameworkDisabledForRoot(options.projectRoot)) {
        console.error('paqad is disabled (vanilla mode); no speed report is built.\n');
        return;
      }
      try {
        const report = buildSpeedReport({
          projectRoot: options.projectRoot,
          change: options.change,
          since: options.since,
          transcriptsRoot: options.transcriptsRoot,
        });
        if (options.json) console.log(JSON.stringify(report, null, 2));
        else console.log(renderSpeedReport(report).trimEnd());
      } catch (error) {
        if (!(error instanceof SpeedReportInputError)) throw error;
        console.error(error.message);
        process.exitCode = 1;
      }
    });

  return command;
}

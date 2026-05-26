import { resolve } from 'node:path';

import { Command } from 'commander';

import { renderMarkdown } from '@/dashboard/markdown.js';
import { buildReport } from '@/dashboard/report.js';

interface StatusCommandOptions {
  format: string;
  projectRoot: string;
}

/**
 * `paqad-ai status` — one-shot LLM-friendly snapshot of the dashboard
 * report. Reuses the same buildReport() pipeline the dashboard server
 * does, so what the agent sees matches what the human sees.
 */
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Print a one-shot dashboard report (Markdown or JSON)')
    .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: StatusCommandOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const fmt = options.format.toLowerCase();
      if (fmt !== 'markdown' && fmt !== 'json') {
        process.stderr.write(
          `error: invalid --format value '${options.format}' (expected markdown or json)\n`,
        );
        process.exitCode = 2;
        return;
      }
      const report = buildReport(projectRoot);
      const output = fmt === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report);
      process.stdout.write(`${output}\n`);
    });
}

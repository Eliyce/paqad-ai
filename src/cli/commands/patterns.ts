import { Command } from 'commander';

import { PatternCli } from '@/patterns/index.js';
import { PatternStore } from '@/patterns/index.js';

export function createPatternsCommand(): Command {
  const cmd = new Command('patterns').description('Manage the cross-project pattern library');

  cmd
    .command('list')
    .description('List saved patterns')
    .option('--domain <domain>', 'Filter by domain')
    .option('--category <category>', 'Filter by category')
    .option('--frameworks <frameworks>', 'Comma-separated list of frameworks to filter by')
    .option('--keywords <keywords>', 'Comma-separated keywords to search in problem preview')
    .action(
      async (options: {
        domain?: string;
        category?: string;
        frameworks?: string;
        keywords?: string;
      }) => {
        const store = new PatternStore();
        const cli = new PatternCli(store);
        await cli.list({
          domain: options.domain,
          category: options.category,
          frameworks: options.frameworks?.split(',').map((f) => f.trim()),
          keywords: options.keywords?.split(',').map((k) => k.trim()),
        });
      },
    );

  cmd
    .command('prune')
    .description('Remove stale patterns older than a threshold')
    .option('--older-than <days>', 'Age threshold in days (default: 180)', '180')
    .action(async (options: { olderThan: string }) => {
      const store = new PatternStore();
      const cli = new PatternCli(store);
      await cli.prune(Number(options.olderThan));
    });

  cmd
    .command('export <output>')
    .description('Export patterns to a file')
    .option('--format <format>', 'Output format: json or markdown (default: json)', 'json')
    .action(async (output: string, options: { format: string }) => {
      const store = new PatternStore();
      const cli = new PatternCli(store);
      const format = options.format === 'markdown' ? 'markdown' : 'json';
      await cli.exportPatterns(output, format);
    });

  return cmd;
}

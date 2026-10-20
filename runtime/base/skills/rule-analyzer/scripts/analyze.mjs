#!/usr/bin/env node
import { scanAndEmbedIds } from 'paqad-ai/rule-scripts';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  process.stdout.write(
    'Usage: node scripts/analyze.mjs [project-root]\n' +
      'Embeds RL-<hash> markers and prints the rule inventory as JSON.\n',
  );
  process.exit(0);
}

const projectRoot = arg ?? process.cwd();
const result = scanAndEmbedIds(projectRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

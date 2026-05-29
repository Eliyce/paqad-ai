#!/usr/bin/env node
// Purpose: Scan docs/instructions/rules/**, embed stable RL-<hash> markers into
//          every rule bullet (idempotent), and print the rule inventory +
//          rule_files_hash as JSON for the rule-analyzer skill to classify.
// Usage:   node scripts/analyze.mjs [project-root]
//          project-root defaults to the current directory.
// Output:  JSON { inventory, files, rule_files_hash, changed_files } on stdout.
// Note:    No paqad-ai CLI command is invoked — this imports the compiled
//          engine via the package self-reference (issue #89).
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

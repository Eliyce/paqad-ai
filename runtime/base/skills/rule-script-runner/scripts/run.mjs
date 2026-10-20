#!/usr/bin/env node
import { runRuleScripts } from 'paqad-ai/rule-scripts';

const [, , projectRoot, mode, ...changed] = process.argv;
if (!projectRoot || !mode) {
  process.stdout.write('Usage: node scripts/run.mjs <project-root> <mode> [changed-file ...]\n');
  process.exit(1);
}

if (mode === 'off') {
  process.stdout.write(JSON.stringify({ mode: 'off', skipped: true }, null, 2) + '\n');
  process.exit(0);
}

const report = runRuleScripts({
  projectRoot,
  mode,
  changedFiles: changed.length > 0 ? changed : undefined,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.blocking ? 1 : 0);

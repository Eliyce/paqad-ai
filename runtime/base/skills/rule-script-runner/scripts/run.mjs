#!/usr/bin/env node
// Purpose: Run all registered rule scripts diff-scoped, aggregate findings into
//          .paqad/scripts/rules/.cache/report.json (hash-cached), and report
//          whether the checks stage is blocked. Invoked from
//          feature-development.checks via the rule-script-runner skill.
// Usage:   node scripts/run.mjs <project-root> <mode> [changed-file ...]
//          mode: off | warn | strict
// Output:  JSON RunReport on stdout.
// Exit:    0 unless mode=strict and a deterministic finding blocks the stage.
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

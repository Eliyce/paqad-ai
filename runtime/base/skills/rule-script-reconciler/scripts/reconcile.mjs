#!/usr/bin/env node
import { reconcileRuleScripts } from 'paqad-ai/rule-scripts';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  process.stdout.write('Usage: node scripts/reconcile.mjs [project-root]\n');
  process.exit(0);
}

const report = reconcileRuleScripts(arg ?? process.cwd());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.blocked ? 1 : 0);

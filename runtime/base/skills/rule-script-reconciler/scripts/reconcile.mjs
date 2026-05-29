#!/usr/bin/env node
// Purpose: Detect rules-as-scripts drift (rules edited/added/removed without
//          regen, manual map edits, scripts failing their own fixtures, stale
//          cache) and write .paqad/scripts/rules/.cache/drift.json. Invoked at
//          feature-development planning entry.
// Usage:   node scripts/reconcile.mjs [project-root]
// Output:  JSON RuleScriptDriftReport on stdout.
// Exit:    0 clean, 1 blocked (any RS-* drift except RS-CACHE-INVALID).
import { reconcileRuleScripts } from 'paqad-ai/rule-scripts';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  process.stdout.write('Usage: node scripts/reconcile.mjs [project-root]\n');
  process.exit(0);
}

const report = reconcileRuleScripts(arg ?? process.cwd());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.blocked ? 1 : 0);

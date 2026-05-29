#!/usr/bin/env node
// Purpose: Record rule conflicts found by the analyzer's semantic pass as
//          RS-CONFLICT findings in .paqad/scripts/rules/.cache/drift.json, so
//          the dashboard + planning gate see them. A deterministic reconciler
//          cannot decide semantic contradiction — this is the analyzer's wire.
// Usage:   node scripts/record-conflicts.mjs <project-root> <conflicts.json>
//          conflicts.json: [{ "rule_ids": ["RL-7f3a","RL-2c9b"],
//                             "message": "named vs default export contradiction" }]
// Output:  JSON RuleScriptDriftReport on stdout. Exit 1 if any conflict recorded.
import { readFileSync } from 'node:fs';

import { recordConflictFindings } from 'paqad-ai/rule-scripts';

const [, , projectRoot, conflictsPath] = process.argv;
if (!projectRoot || !conflictsPath) {
  process.stdout.write(
    'Usage: node scripts/record-conflicts.mjs <project-root> <conflicts.json>\n',
  );
  process.exit(1);
}

const conflicts = JSON.parse(readFileSync(conflictsPath, 'utf8'));
const report = recordConflictFindings(projectRoot, conflicts);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.counts['RS-CONFLICT'] > 0 ? 1 : 0);

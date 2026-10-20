#!/usr/bin/env node
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

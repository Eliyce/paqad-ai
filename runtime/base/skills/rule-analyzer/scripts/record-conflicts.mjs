#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { recordConflictFindings } from 'paqad-ai/rule-scripts';

const [, , projectRoot, conflictsPath] = process.argv;
const help = projectRoot === '--help' || projectRoot === '-h';
if (help || !projectRoot || !conflictsPath) {
  process.stdout.write(
    'Usage: node scripts/record-conflicts.mjs <project-root> <conflicts.json>\n',
  );
  process.exit(help ? 0 : 1);
}

let conflictsText;
try {
  conflictsText = readFileSync(conflictsPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  process.stderr.write(`conflicts file not found: ${conflictsPath}\n`);
  process.exit(1);
}
const conflicts = JSON.parse(conflictsText);
const report = recordConflictFindings(projectRoot, conflicts);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.counts['RS-CONFLICT'] > 0 ? 1 : 0);

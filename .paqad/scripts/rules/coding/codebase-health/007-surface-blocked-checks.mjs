// @paqad-rule-script
// rule_id: RL-1af8
// source: docs/instructions/rules/coding/codebase-health.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  if (!/createHealthCommand/.test(text)) continue;
  if (!/blocked_checks/.test(text) || !/install_hint/.test(text)) findings.push({ file, message: 'Health command may fail to surface blocked checks with installation guidance.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-1af8', kind: 'heuristic', findings }));

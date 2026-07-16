// @paqad-rule-script
// rule_id: RL-475c
// source: docs/instructions/rules/coding/health-retest.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  if (!/buildHealthRetestFindings/.test(text)) continue;
  if (!/sourceFindings\.map/.test(text) || !/\.\.\.finding/.test(text)) findings.push({ file, message: 'Retest results may not be derived exclusively from source findings with their original severity.', severity: 'info' });
  if (/severity\s*:\s*['"](?:low|medium)['"]/.test(text)) findings.push({ file, message: 'Retest logic appears to assign a lower severity directly.', severity: 'medium' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-475c', kind: 'heuristic', findings }));

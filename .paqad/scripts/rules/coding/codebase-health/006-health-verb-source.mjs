// @paqad-rule-script
// rule_id: RL-e398
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
  if (!/runHealthAudit\s*\(/.test(text)) findings.push({ file, message: 'Health CLI path may derive findings without invoking the canonical health verb.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-e398', kind: 'heuristic', findings }));

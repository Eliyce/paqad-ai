// @paqad-rule-script
// rule_id: RL-692c
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
  if (!/runHealthAudit/.test(text)) continue;
  if (!/report_path/.test(text) || !/sidecar_path/.test(text) || !/writeJsonFile/.test(text) || !/writeMarkdown/.test(text)) findings.push({ file, message: 'Health run may stop preserving both the report and its retest sidecar.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-692c', kind: 'heuristic', findings }));

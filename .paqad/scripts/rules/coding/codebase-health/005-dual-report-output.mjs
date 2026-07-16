// @paqad-rule-script
// rule_id: RL-2b7d
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
  if (!/writeJsonFile/.test(text) || !/writeMarkdown/.test(text) || !/finding-index\.json/.test(text)) findings.push({ file, message: 'Health audit may not write the markdown, JSON sidecar, and finding index together.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-2b7d', kind: 'heuristic', findings }));

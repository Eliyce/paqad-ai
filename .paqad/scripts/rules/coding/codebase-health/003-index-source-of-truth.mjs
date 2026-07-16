// @paqad-rule-script
// rule_id: RL-5785
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
  if (!/loadIndex\s*\(/.test(text) || !/index-not-built|code-knowledge index has not been built/.test(text)) findings.push({ file, message: 'Health audit may bypass the code-knowledge index or omit its blocked-check path.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5785', kind: 'heuristic', findings }));

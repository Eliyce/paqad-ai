// @paqad-rule-script
// rule_id: RL-4c78
// source: docs/instructions/rules/coding/codebase-health.md
// kind: heuristic
// scope: changed-files
// runtime: node
// false_positive_surface: "Custom routers that intentionally delegate audit phrasing elsewhere."
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  if (!/workflow\s*:\s*['"]codebase-health['"]/.test(text)) continue;
  const missing = ['audit my codebase', 'find dead code', 'check for unused', 'cleanup audit'].filter((p) => !text.toLowerCase().includes(p));
  if (missing.length) findings.push({ file, message: `Health audit routing may miss canonical phrasing: ${missing.join(', ')}`, severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-4c78', kind: 'heuristic', findings }));

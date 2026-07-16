// @paqad-rule-script
// rule_id: RL-2daa
// source: docs/instructions/rules/coding/health-retest.md
// kind: heuristic
// scope: changed-files
// runtime: node
// false_positive_surface: "Custom routers that intentionally delegate equivalent retest phrasing elsewhere."
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  if (!/workflow\s*:\s*['"]health-retest['"]/.test(text)) continue;
  const missing = ['health retest', 'health-retest'].filter((p) => !text.toLowerCase().includes(p));
  if (missing.length) findings.push({ file, message: `Health-retest routing may miss canonical phrasing: ${missing.join(', ')}`, severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-2daa', kind: 'heuristic', findings }));

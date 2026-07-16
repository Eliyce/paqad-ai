// @paqad-rule-script
// rule_id: RL-cb61
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
  if (!/createHealthGatherer/.test(text)) continue;
  const missing = ['osv-scanner', 'gitleaks', 'jscpd', 'blockedFor'].filter((p) => !text.includes(p));
  if (missing.length) findings.push({ file, message: `Health gatherer may omit optional scanner fallback handling: ${missing.join(', ')}`, severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-cb61', kind: 'heuristic', findings }));

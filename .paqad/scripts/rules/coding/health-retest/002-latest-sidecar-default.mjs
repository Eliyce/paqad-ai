// @paqad-rule-script
// rule_id: RL-ec30
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
  if (!/findLatestSidecar/.test(text)) continue;
  if (!/\.filter\(/.test(text) || !/\.sort\(\)/.test(text) || !/\.at\(-1\)/.test(text)) findings.push({ file, message: 'Default health-retest sidecar selection may not choose the newest non-retest JSON report.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-ec30', kind: 'heuristic', findings }));

// @paqad-rule-script
// rule_id: RL-d9a7
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
  if (!/evaluateRetestStatus/.test(text)) continue;
  if (!/finding\.requires_network\s*&&\s*offline/.test(text) || !/needs-manual-verification/.test(text)) findings.push({ file, message: 'Offline network-required findings may be marked fixed instead of needing manual verification.', severity: 'medium' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-d9a7', kind: 'heuristic', findings }));

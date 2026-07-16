// @paqad-rule-script
// rule_id: RL-38db
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
  if (!/currentFindings\.map\(\(finding\)\s*=>\s*finding\.id\)/.test(text) || !/currentIds\.has\(finding\.id\)/.test(text)) findings.push({ file, message: 'Health retest may match findings by something other than the stable HL id.', severity: 'info' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-38db', kind: 'heuristic', findings }));

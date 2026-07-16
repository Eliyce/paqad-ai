// @paqad-rule-script
// rule_id: RL-7664
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
  if (!/runHealthAudit|HealthFinding|HealthCandidate/.test(text)) continue;
  text.split('\n').forEach((line, i) => { if (/\b(unlink|rm|rmdir|removePackage|rewriteFile)\s*\(/.test(line)) findings.push({ file, line: i + 1, message: 'Health workflow appears to apply a destructive remediation automatically.', severity: 'high' }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7664', kind: 'heuristic', findings }));

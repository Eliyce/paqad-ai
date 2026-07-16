// @paqad-rule-script
// rule_id: RL-6e45
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
  if (!/interface\s+SecretMatch|type\s+SecretMatch/.test(text)) continue;
  text.split('\n').forEach((line, i) => { if (/\b(secret|token|credential|value|bytes)\s*[?:]:/i.test(line) && !/fingerprint|never the bytes/i.test(line)) findings.push({ file, line: i + 1, message: 'Secret evidence shape may retain raw secret bytes instead of a fingerprint.', severity: 'high' }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-6e45', kind: 'heuristic', findings }));

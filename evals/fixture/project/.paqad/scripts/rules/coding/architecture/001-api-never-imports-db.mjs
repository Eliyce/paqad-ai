// @paqad-rule-script
// rule_id: RL-569d
// source: docs/instructions/rules/coding/architecture.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const IMPORT = /\b(?:from|import|require)\s*\(?\s*['"][^'"]*\bdb\//;
for (const file of files) {
  if (!file.startsWith('src/api/')) continue;
  let text;
  try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    if (IMPORT.test(line)) findings.push({ file, line: i + 1, message: 'src/api/ must not import from src/db/', severity: 'blocker' });
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-569d', kind: 'deterministic', findings }));

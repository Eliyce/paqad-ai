// @paqad-rule-script
// rule_id: RL-770f
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/testing.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
for (const file of files) {
  if (!file.endsWith('.py') || !file.split('/').includes('tests')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/^\s*import\s+(pytest|nose)\b/.test(line) || /^\s*from\s+(pytest|nose)\b/.test(line)) {
      findings.push({ file, line: i + 1, message: 'tests must use unittest only', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-770f', kind: 'deterministic', findings }));

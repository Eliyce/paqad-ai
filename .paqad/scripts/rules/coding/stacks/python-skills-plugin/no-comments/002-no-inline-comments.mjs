// @paqad-rule-script
// rule_id: RL-d7fc
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/no-comments.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
function strip(line) {
  return line.replace(/"([^"\\]|\\.)*"/g, '""').replace(/'([^'\\]|\\.)*'/g, "''");
}
for (const file of files) {
  if (!file.endsWith('.py')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (i === 0 && /^#!/.test(line)) return;
    if (strip(line).includes('#')) {
      findings.push({ file, line: i + 1, message: 'comment in a Python file (only a line-1 shebang is allowed)', severity: 'medium' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-d7fc', kind: 'heuristic', findings }));

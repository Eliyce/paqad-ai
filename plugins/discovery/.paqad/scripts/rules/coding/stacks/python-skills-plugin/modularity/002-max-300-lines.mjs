// @paqad-rule-script
// rule_id: RL-de26
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/modularity.md
// kind: deterministic
// scope: whole-tree
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
const MAX = 300;
for (const file of files) {
  if (!file.endsWith('.py')) continue;
  const text = read(file);
  if (text === null) continue;
  const count = text.split('\n').length;
  if (count > MAX) {
    findings.push({ file, line: MAX + 1, message: 'Python file exceeds ' + MAX + ' lines (' + count + ')', severity: 'medium' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-de26', kind: 'deterministic', findings }));

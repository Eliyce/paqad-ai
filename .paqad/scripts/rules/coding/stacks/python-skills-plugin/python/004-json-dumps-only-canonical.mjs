// @paqad-rule-script
// rule_id: RL-9edb
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/python.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
for (const file of files) {
  if (!file.endsWith('.py')) continue;
  if (file.endsWith('shared/scripts/canonical.py')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/\bjson\.dumps\s*\(/.test(line)) {
      findings.push({ file, line: i + 1, message: 'json.dumps outside shared/scripts/canonical.py', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-9edb', kind: 'heuristic', findings }));

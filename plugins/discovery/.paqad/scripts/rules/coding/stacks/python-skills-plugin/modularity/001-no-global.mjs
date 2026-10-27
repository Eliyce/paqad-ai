// @paqad-rule-script
// rule_id: RL-8323
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/modularity.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
for (const file of files) {
  if (!file.endsWith('.py')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/^\s*global\s+\w/.test(line)) {
      findings.push({ file, line: i + 1, message: 'global statement', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-8323', kind: 'deterministic', findings }));

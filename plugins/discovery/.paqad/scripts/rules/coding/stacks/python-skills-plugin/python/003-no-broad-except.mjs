// @paqad-rule-script
// rule_id: RL-b4db
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/python.md
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
    if (/^\s*except\s*:/.test(line) || /^\s*except\s+Exception(\s|:|,)/.test(line) || /^\s*except\s+BaseException(\s|:|,)/.test(line)) {
      findings.push({ file, line: i + 1, message: 'bare or overly broad except', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-b4db', kind: 'deterministic', findings }));

// @paqad-rule-script
// rule_id: RL-1334
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
  if (!file.endsWith('.py') || file.split('/').includes('tests')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/^\s*assert(\s|\()/.test(line)) {
      findings.push({ file, line: i + 1, message: 'assert in a shipped script', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-1334', kind: 'deterministic', findings }));

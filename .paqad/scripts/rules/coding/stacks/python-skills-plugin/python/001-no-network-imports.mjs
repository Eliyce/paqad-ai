// @paqad-rule-script
// rule_id: RL-9e8b
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/python.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
const FORBID = /^\s*import\s+(socket|http|ssl|smtplib|ftplib|subprocess)(\.|\s|$)/;
const FORBID_FROM = /^\s*from\s+(socket|http|ssl|smtplib|ftplib|subprocess|urllib\.request)(\.|\s)/;
const URLLIB = /^\s*import\s+urllib\.request(\.|\s|$)/;
for (const file of files) {
  if (!file.endsWith('.py')) continue;
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (FORBID.test(line) || FORBID_FROM.test(line) || URLLIB.test(line)) {
      findings.push({ file, line: i + 1, message: 'forbidden network/subprocess import in a shipped script', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-9e8b', kind: 'deterministic', findings }));

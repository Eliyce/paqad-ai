// @paqad-rule-script
// rule_id: RL-c586
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
const payload = JSON.parse(readFileSync(0, 'utf8'));
const projectRoot = payload.projectRoot;
// test fixtures deliberately contain violations — they are samples, not code
const files = payload.files.filter((f) => !/(^|\/)(__fixtures__|fixtures)(\/|$)/.test(f));
const findings = [];
const read = (rel) => { try { return readFileSync(join(projectRoot, rel), 'utf8'); } catch { return null; } };
for (const file of files) {
  if (basename(file) !== 'SKILL.md') continue;
  const text = read(file); if (text === null) continue;
  const lines = text.split('\n').length;
  if (lines > 500) findings.push({ file, line: 501, message: `SKILL.md is ${lines} lines (max ~500); move detail to references/`, severity: 'high' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-c586', kind: 'deterministic', findings }));

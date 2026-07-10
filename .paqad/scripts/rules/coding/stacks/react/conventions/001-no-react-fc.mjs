// @paqad-rule-script
// rule_id: RL-502e
// source: docs/instructions/rules/coding/stacks/react/conventions.md
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
  if (!/\.(tsx|ts)$/.test(file)) continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/React\.(FC|FunctionComponent)\b|:\s*FC</.test(line)) {
      findings.push({ file, line: i + 1, message: 'React.FC is discouraged — type props with an explicit interface/type instead', severity: 'medium' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-502e', kind: 'deterministic', findings }));

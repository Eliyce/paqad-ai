// @paqad-rule-script
// rule_id: RL-681b
// source: docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md
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
  if (!/\.(tsx|ts|jsx|js)$/.test(file) || /vite\.config|\.config\./.test(basename(file))) continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/['"\`]\/src\/[^'"\`]*['"\`]/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      findings.push({ file, line: i + 1, message: 'hard-coded /src/ asset path breaks in the production build — import the asset or serve it from public/', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-681b', kind: 'deterministic', findings }));

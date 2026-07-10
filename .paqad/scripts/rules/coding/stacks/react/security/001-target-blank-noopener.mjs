// @paqad-rule-script
// rule_id: RL-faf7
// source: docs/instructions/rules/coding/stacks/react/security.md
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
  if (!/\.(tsx|jsx)$/.test(file)) continue;
  const text = read(file); if (text === null) continue;
  const re = /target\s*=\s*(?:"_blank"|'_blank'|\{\s*['"]_blank['"]\s*\})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = text.lastIndexOf('<', m.index);
    const close = text.indexOf('>', m.index);
    const tag = text.slice(open >= 0 ? open : m.index, close >= 0 ? close + 1 : m.index + 60);
    if (!/rel\s*=\s*[^>]*noopener/.test(tag)) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file, line, message: 'target="_blank" without rel="noopener noreferrer" enables reverse-tabnabbing', severity: 'high' });
    }
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-faf7', kind: 'deterministic', findings }));

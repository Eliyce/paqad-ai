// @paqad-rule-script
// rule_id: RL-da67
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
  if (basename(file) === 'SKILL.md') {
    const text = read(file); if (text === null) continue;
    const refsDir = join(projectRoot, dirname(file), 'references');
    if (!existsSync(refsDir)) continue;
    for (const ref of readdirSync(refsDir)) {
      if (!ref.endsWith('.md')) continue;
      if (!text.includes(ref)) findings.push({ file, message: `references/${ref} is never cited from SKILL.md — dead weight or add a load condition`, severity: 'high' });
    }
  } else if (/(^|\/)references\/[^/]+\.md$/.test(file)) {
    const parent = file.split('/').slice(0, -2).join('/');
    const skillRel = (parent ? parent + '/' : '') + 'SKILL.md';
    if (files.includes(skillRel)) continue;
    const skill = read(skillRel); if (skill === null) continue;
    if (!skill.includes(basename(file))) findings.push({ file, message: `not cited from ${skillRel} — dead weight or add a load condition`, severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-da67', kind: 'deterministic', findings }));

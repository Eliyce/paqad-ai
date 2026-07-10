// @paqad-rule-script
// rule_id: RL-b124
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
    const scriptsDir = join(projectRoot, dirname(file), 'scripts');
    if (!existsSync(scriptsDir)) continue;
    for (const s of readdirSync(scriptsDir)) {
      if (!/\.(sh|mjs|js|py)$/.test(s)) continue;
      if (!text.includes(s)) findings.push({ file, message: `scripts/${s} is not referenced under ## Resources`, severity: 'high' });
    }
  } else if (/(^|\/)scripts\/[^/]+\.(sh|mjs|js|py)$/.test(file) && /(^|\/)skills\//.test(file)) {
    const parent = file.split('/').slice(0, -2).join('/');
    const skillRel = (parent ? parent + '/' : '') + 'SKILL.md';
    if (files.includes(skillRel)) continue;
    const skill = read(skillRel); if (skill === null) continue;
    if (!skill.includes(basename(file))) findings.push({ file, message: `not referenced from ${skillRel} under ## Resources`, severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-b124', kind: 'deterministic', findings }));

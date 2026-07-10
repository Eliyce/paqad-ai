// @paqad-rule-script
// rule_id: RL-ea76
// source: docs/instructions/rules/coding/stacks/_shared/git.md
// kind: deterministic
// scope: whole-tree
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
  // fixtures cannot carry dotfiles, so a bare "gitignore" basename is accepted too
  if (basename(file) !== '.gitignore' && basename(file) !== 'gitignore') continue;
  if (file.includes('/') && basename(file) === '.gitignore') continue; // root .gitignore only
  const text = read(file); if (text === null) continue;
  const CHECKS = [
    [/(^|\/|\s)node_modules/m, 'node_modules is not ignored'],
    [/(^|\s)(dist|build|out)\b/m, 'build output (dist/build/out) is not ignored'],
    [/\.env/m, '.env files are not ignored'],
  ];
  for (const [re, msg] of CHECKS) {
    if (!re.test(text)) findings.push({ file, message: msg, severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-ea76', kind: 'deterministic', findings }));

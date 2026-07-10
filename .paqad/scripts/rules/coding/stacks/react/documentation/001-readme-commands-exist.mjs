// @paqad-rule-script
// rule_id: RL-32f1
// source: docs/instructions/rules/coding/stacks/react/documentation.md
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
  if (!/^README[^/]*\.md$/i.test(basename(file))) continue;
  const text = read(file); if (text === null) continue;
  const parent = file.split('/').slice(0, -1).join('/');
  const pkgRel = (parent ? parent + '/' : '') + 'package.json';
  let scripts = null;
  // sibling package.json first, root manifest as fallback for nested docs READMEs
  const raw = read(pkgRel) ?? read('package.json');
  if (raw !== null) { try { scripts = JSON.parse(raw).scripts ?? {}; } catch { scripts = null; } }
  for (const m of text.matchAll(/(?:pnpm|npm|yarn)(?:\s+-[^\s]+)*\s+run\s+([a-z0-9:_-]+)/g)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (scripts === null) findings.push({ file, line, message: `README names "run ${m[1]}" but no readable package.json defines scripts`, severity: 'medium' });
    else if (!(m[1] in scripts)) findings.push({ file, line, message: `README names "run ${m[1]}" but package.json has no such script`, severity: 'medium' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-32f1', kind: 'deterministic', findings }));

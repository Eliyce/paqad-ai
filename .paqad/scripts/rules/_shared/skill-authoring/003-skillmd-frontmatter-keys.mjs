// @paqad-rule-script
// rule_id: RL-5b7a
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
const ALLOWED = new Set(['name', 'description', 'model_tier', 'triggers', 'cacheable', 'cache_key_inputs', 'output_format', 'input_schema']);
for (const file of files) {
  if (basename(file) !== 'SKILL.md') continue;
  const text = read(file); if (text === null) continue;
  if (!text.startsWith('---\n')) { findings.push({ file, line: 1, message: 'SKILL.md missing frontmatter block', severity: 'high' }); continue; }
  const end = text.indexOf('\n---', 4); if (end < 0) continue;
  const fm = text.slice(4, end).split('\n');
  const keys = [];
  fm.forEach((line, i) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (!m) return;
    keys.push(m[1]);
    if (!ALLOWED.has(m[1])) findings.push({ file, line: i + 2, message: `undocumented frontmatter key "${m[1]}" — mirror a peer skill's shape`, severity: 'high' });
  });
  for (const req of ['name', 'description']) {
    if (!keys.includes(req)) findings.push({ file, line: 1, message: `frontmatter missing required key "${req}"`, severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5b7a', kind: 'deterministic', findings }));

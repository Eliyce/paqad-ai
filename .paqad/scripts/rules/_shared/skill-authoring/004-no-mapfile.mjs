// @paqad-rule-script
// rule_id: RL-e340
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
  if (!file.endsWith('.sh') || !/(^|\/)skills\//.test(file)) continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/(^|[^A-Za-z0-9_.-])mapfile([^A-Za-z0-9_.-]|$)/.test(line) && !line.trim().startsWith('#')) {
      findings.push({ file, line: i + 1, message: 'mapfile is not available on bash 3.2 — use a while read -r loop', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-e340', kind: 'deterministic', findings }));

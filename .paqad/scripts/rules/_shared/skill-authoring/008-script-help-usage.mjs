// @paqad-rule-script
// rule_id: RL-6ac2
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
  if (!/(^|\/)skills\/[^/]+\/scripts\/[^/]+\.(sh|mjs)$/.test(file)) continue;
  const text = read(file); if (text === null) continue;
  if (!text.includes('--help')) findings.push({ file, line: 1, message: 'script has no --help handling (must exit 0 and document usage)', severity: 'high' });
  else if (!/usage/i.test(text)) findings.push({ file, line: 1, message: 'script --help does not document Usage', severity: 'high' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-6ac2', kind: 'deterministic', findings }));

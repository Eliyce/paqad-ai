// @paqad-rule-script
// rule_id: RL-d5f6
// source: docs/instructions/rules/coding/stacks/react/environment.md
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
  const name = basename(file);
  if (!/^\.env(\..+)?$/.test(name) && !/\.env$/.test(name)) continue;
  if (/example|sample|template|dist/i.test(name)) continue;
  findings.push({ file, line: 1, message: 'env file committed to the repo — commit a .env.example with placeholders instead', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-d5f6', kind: 'deterministic', findings }));

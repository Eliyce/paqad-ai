// @paqad-rule-script
// rule_id: RL-5fcf
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
  const head = text.split('\n').slice(0, 10).join('\n');
  if (!/set -euo pipefail/.test(head)) {
    findings.push({ file, line: 1, message: 'missing "set -euo pipefail" near the top of the script', severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5fcf', kind: 'deterministic', findings }));

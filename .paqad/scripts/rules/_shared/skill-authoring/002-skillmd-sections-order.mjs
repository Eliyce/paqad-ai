// @paqad-rule-script
// rule_id: RL-9077
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
const REQUIRED = ['## What It Does', '## Use This When', '## Inputs', '## Procedure', '## Output Contract', '## Escalate / Stop Conditions', '## Resources'];
for (const file of files) {
  if (basename(file) !== 'SKILL.md') continue;
  const text = read(file); if (text === null) continue;
  let last = -1;
  for (const section of REQUIRED) {
    const idx = text.indexOf('\n' + section);
    if (idx < 0) { findings.push({ file, message: `missing required section "${section}"`, severity: 'high' }); continue; }
    if (idx < last) findings.push({ file, message: `section "${section}" out of order`, severity: 'high' });
    last = Math.max(last, idx);
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-9077', kind: 'deterministic', findings }));

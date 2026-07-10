// @paqad-rule-script
// rule_id: RL-7891
// source: docs/instructions/rules/coding/stacks/react/testing.md
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
  if (!/\.(test|spec)\.(tsx?|jsx?)$/.test(file)) continue;
  const text = read(file); if (text === null || !text.includes('@testing-library')) continue;
  text.split('\n').forEach((line, i) => {
    if (/\bfireEvent\b/.test(line)) {
      findings.push({ file, line: i + 1, message: 'use @testing-library/user-event instead of raw fireEvent so events match real browser sequences', severity: 'medium' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7891', kind: 'deterministic', findings }));

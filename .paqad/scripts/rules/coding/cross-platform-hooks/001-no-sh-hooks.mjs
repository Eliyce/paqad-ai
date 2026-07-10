// @paqad-rule-script
// rule_id: RL-0235
// source: docs/instructions/rules/coding/cross-platform-hooks.md
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
  if (!file.endsWith('.json')) continue;
  const text = read(file); if (text === null || !text.includes('"hooks"')) continue;
  text.split('\n').forEach((line, i) => {
    const m = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m && /\.sh(\s|\\|"|'|$)/.test(m[1])) {
      findings.push({ file, line: i + 1, message: 'hook command invokes a .sh script — hooks must be cross-platform .mjs launched via an explicit interpreter', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-0235', kind: 'deterministic', findings }));

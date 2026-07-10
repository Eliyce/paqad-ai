// @paqad-rule-script
// rule_id: RL-c6c2
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
const INTERP = /^(node|node\.exe|npx|sh|bash|cmd|cmd\.exe|powershell|pwsh|python3?)\b/;
for (const file of files) {
  if (!file.endsWith('.json')) continue;
  const text = read(file); if (text === null || !text.includes('"hooks"')) continue;
  text.split('\n').forEach((line, i) => {
    const m = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (m && m[1].trim() && !INTERP.test(m[1].trim())) {
      findings.push({ file, line: i + 1, message: 'hook command does not launch through an explicit interpreter (node/sh/cmd…) — bare paths break cross-platform', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-c6c2', kind: 'deterministic', findings }));

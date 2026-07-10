// @paqad-rule-script
// rule_id: RL-974c
// source: docs/instructions/rules/coding/agent-entry-files.md
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
const ENTRY = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);
for (const file of files) {
  if (!ENTRY.has(basename(file))) continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (line.includes('docs/instructions') || line.includes('docs/modules')) {
      findings.push({ file, line: i + 1, message: 'entry file names a docs/instructions or docs/modules load — entry files must stay lean stubs; the bootstrap owns loading', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-974c', kind: 'deterministic', findings }));

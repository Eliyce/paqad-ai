// @paqad-rule-script
// rule_id: RL-5ca2
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
const BUILTINS = new Set(['MODE', 'BASE_URL', 'PROD', 'DEV', 'SSR']);
for (const file of files) {
  if (!/\.(ts|tsx|js|jsx|mts)$/.test(file)) continue;
  const text = read(file); if (text === null) continue;
  for (const m of text.matchAll(/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = m[1];
    if (!name.startsWith('VITE_') && !BUILTINS.has(name)) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file, line, message: `import.meta.env.${name} is not VITE_-prefixed — it will be undefined in the bundle (and must never hold a secret)`, severity: 'high' });
    }
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5ca2', kind: 'deterministic', findings }));

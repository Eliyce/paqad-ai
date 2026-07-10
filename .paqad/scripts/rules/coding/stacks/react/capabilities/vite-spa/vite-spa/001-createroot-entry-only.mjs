// @paqad-rule-script
// rule_id: RL-ff60
// source: docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md
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
const ENTRY = new Set(['main.tsx', 'main.jsx', 'main.ts', 'index.tsx']);
for (const file of files) {
  // React component sources only — CLI/test .ts files legitimately mention createRoot in strings
  if (!/\.(tsx|jsx)$/.test(file) || ENTRY.has(basename(file))) continue;
  if (/\.(test|spec)\./.test(file) || /(^|\/)tests?\//.test(file)) continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (/\bcreateRoot\s*\(/.test(line)) {
      findings.push({ file, line: i + 1, message: 'createRoot outside the app entry (main.tsx) — keep bootstrapping in one entry module', severity: 'high' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-ff60', kind: 'deterministic', findings }));

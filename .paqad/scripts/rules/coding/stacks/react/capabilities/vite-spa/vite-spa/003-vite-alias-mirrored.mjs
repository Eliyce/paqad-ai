// @paqad-rule-script
// rule_id: RL-5e07
// source: docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md
// kind: deterministic
// scope: whole-tree
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
  if (!/vite\.config\.(ts|js|mts|mjs)$/.test(basename(file))) continue;
  const text = read(file); if (text === null) continue;
  const aliasBlock = /alias\s*:\s*\{([\s\S]*?)\}/.exec(text);
  if (!aliasBlock) continue;
  const aliases = [...aliasBlock[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map((m) => m[1]);
  if (aliases.length === 0) continue;
  const tsRaw = read(join(dirname(file), 'tsconfig.json'));
  let paths = {};
  if (tsRaw !== null) {
    try { paths = JSON.parse(tsRaw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).compilerOptions?.paths ?? {}; } catch { paths = {}; }
  }
  const bases = Object.keys(paths).map((p) => p.replace(/\/\*$/, ''));
  for (const alias of aliases) {
    if (!bases.includes(alias)) {
      findings.push({ file, message: `vite alias "${alias}" is not mirrored in tsconfig paths — divergent alias sets`, severity: 'high' });
    }
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5e07', kind: 'deterministic', findings }));

// @paqad-rule-script
// rule_id: RL-0b31
// source: docs/instructions/rules/_shared/documentation.md
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
const DOC = files.find((f) => f.endsWith('docs/instructions/stack/versions.md') || f === 'versions.md');
const MANIFESTS = ['package.json', 'graph-ui/package.json', 'composer.json'];
const loadDeps = () => {
  const deps = new Map();
  for (const m of MANIFESTS) {
    const raw = read(m); if (raw === null) continue;
    try {
      const pkg = JSON.parse(raw);
      for (const group of [pkg.dependencies, pkg.devDependencies]) {
        for (const [name, range] of Object.entries(group ?? {})) {
          if (!deps.has(name)) deps.set(name, new Set());
          deps.get(name).add(range);
        }
      }
    } catch { /* unparseable manifest is another rule's problem */ }
  }
  return deps;
};
if (DOC) {
  const text = read(DOC);
  if (text !== null) {
    const deps = loadDeps();
    text.split('\n').forEach((line, i) => {
      const m = /^-\s+\`([@a-z0-9/_.-]+)\s+([^\`]+)\`/.exec(line);
      if (!m) return;
      const [, name, range] = m;
      if (!deps.has(name)) findings.push({ file: DOC, line: i + 1, message: `documents "${name} ${range}" but no manifest declares ${name} — stale stack doc`, severity: 'medium' });
      else if (!deps.get(name).has(range.trim())) findings.push({ file: DOC, line: i + 1, message: `documents "${name} ${range}" but manifests declare ${[...deps.get(name)].join(', ')}`, severity: 'medium' });
    });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-0b31', kind: 'deterministic', findings }));

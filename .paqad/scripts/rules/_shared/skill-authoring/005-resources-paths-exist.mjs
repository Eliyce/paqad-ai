// @paqad-rule-script
// rule_id: RL-db2e
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("SKILL\\.md$", "");
const SEV = "medium";
const MSG = "A backticked path under ## Resources does not exist.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '## Resources');
  if (idx === -1) continue;
  const sdir = file.split('/').slice(0, -1).join('/');
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const m = lines[i].match(/`([^`]+\.(md|mjs|ts|sh|txt|json|yaml|yml))`/g);
    if (!m) continue;
    for (const g of m) { const p = g.replace(/`/g, ''); if (!/^(references|scripts|assets)\//.test(p)) continue; if (!existsSync(join(projectRoot, p)) && !existsSync(join(projectRoot, sdir, p))) findings.push({ file, line: i + 1, message: MSG + ' (' + p + ')', severity: SEV }); }
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-db2e', kind: 'deterministic', findings }));

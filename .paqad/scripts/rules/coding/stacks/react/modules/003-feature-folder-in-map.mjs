// @paqad-rule-script
// rule_id: RL-95f2
// source: docs/instructions/rules/coding/stacks/react/modules.md
// kind: deterministic
// scope: whole-tree
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "medium";
const MSG = "New top-level feature folder without a matching module-map.yml entry.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const m = /src\/features\/([^/]+)\//.exec(file); if (!m) continue;
  const mapP = join(projectRoot, 'docs/instructions/rules/module-map.yml');
  const map = existsSync(mapP) ? readFileSync(mapP, 'utf8') : '';
  if (!map.includes(m[1])) findings.push({ file, message: MSG + ' (' + m[1] + ')', severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-95f2', kind: 'deterministic', findings }));

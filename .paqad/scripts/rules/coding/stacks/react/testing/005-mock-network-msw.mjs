// @paqad-rule-script
// rule_id: RL-dd48
// source: docs/instructions/rules/coding/stacks/react/testing.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("global\\.fetch\\s*=|stubGlobal\\(\\s*['\"]fetch", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "info";
const MSG = "Stubbing fetch directly — mock the network at the boundary with MSW.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-dd48', kind: 'heuristic', findings }));

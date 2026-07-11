// @paqad-rule-script
// rule_id: RL-f3c7
// source: docs/instructions/rules/coding/stacks/react/environment.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Scattered env read in a component — read env through one typed, validated config module.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (/(config|env)\.(ts|tsx|js)$/.test(file)) continue;
  lines.forEach((ln, i) => { if (/(import\.meta\.env|process\.env)\.[A-Za-z]/.test(ln)) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-f3c7', kind: 'heuristic', findings }));

// @paqad-rule-script
// rule_id: RL-b773
// source: docs/instructions/rules/coding/stacks/react/localization.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("getByText\\(\\s*['\"][A-Z][a-z]+ ", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "info";
const MSG = "Asserting a translated literal — query by key/role/test id so a copy edit doesn't break the test.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-b773', kind: 'heuristic', findings }));

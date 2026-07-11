// @paqad-rule-script
// rule_id: RL-0c81
// source: docs/instructions/rules/coding/stacks/react/security.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\bevent\\.data\\b", "");
const SKIP = new RegExp("(schema|parse|validate|zod)", "");
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "low";
const MSG = "Trust-boundary data used without a schema validator — parse it before use.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-0c81', kind: 'heuristic', findings }));

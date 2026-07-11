// @paqad-rule-script
// rule_id: RL-2ba0
// source: docs/instructions/rules/coding/stacks/react/environment.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("process\\.env\\.\\w*(SECRET|KEY|PASSWORD|TOKEN)", "i");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "i");
const SEV = "high";
const MSG = "Server-only secret referenced in a client module — keep it out of the browser bundle.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-2ba0', kind: 'heuristic', findings }));

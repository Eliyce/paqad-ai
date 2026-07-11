// @paqad-rule-script
// rule_id: RL-1aed
// source: docs/instructions/rules/coding/stacks/react/conventions.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("(\\bif\\s*\\([^)]*\\)\\s*|&&\\s*|\\?\\s*)use(State|Effect|Memo|Callback|Ref|Reducer|Context)\\s*\\(", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "high";
const MSG = "Hook called conditionally — call every hook unconditionally at the top level.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-1aed', kind: 'deterministic', findings }));

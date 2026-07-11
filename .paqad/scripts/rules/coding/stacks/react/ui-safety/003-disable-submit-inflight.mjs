// @paqad-rule-script
// rule_id: RL-c412
// source: docs/instructions/rules/coding/stacks/react/ui-safety.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("type=['\"]submit['\"]", "");
const SKIP = null;
const NEED = new RegExp("disabled=", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Submit control not disabled while a mutation is in flight — a double-click can double-submit.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-c412', kind: 'heuristic', findings }));

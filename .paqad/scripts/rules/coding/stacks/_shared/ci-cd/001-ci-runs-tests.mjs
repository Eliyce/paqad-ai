// @paqad-rule-script
// rule_id: RL-469b
// source: docs/instructions/rules/coding/stacks/_shared/ci-cd.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("on:", "");
const SKIP = null;
const NEED = new RegExp("\\btest\\b", "");
const FILTER = new RegExp("workflows/.*\\.ya?ml$", "");
const SEV = "low";
const MSG = "CI workflow does not run tests — run the same gates CI that block local delivery.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-469b', kind: 'heuristic', findings }));

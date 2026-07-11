// @paqad-rule-script
// rule_id: RL-b43e
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("while\\s+IFS=.*read", "");
const SKIP = null;
const NEED = new RegExp("\\|\\|\\s*\\[\\s*-n", "");
const FILTER = new RegExp("\\.sh$", "");
const SEV = "info";
const MSG = "read loop may drop a final line with no trailing newline — guard with `|| [ -n \"$x\" ]`.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-b43e', kind: 'heuristic', findings }));

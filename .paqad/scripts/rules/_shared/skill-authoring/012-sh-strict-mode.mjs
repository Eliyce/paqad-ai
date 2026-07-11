// @paqad-rule-script
// rule_id: RL-aa4e
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = new RegExp("set -euo pipefail", "");
const FILTER = new RegExp("\\.sh$", "");
const SEV = "low";
const MSG = "Shell script missing `set -euo pipefail` at the top.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (!NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-aa4e', kind: 'deterministic', findings }));

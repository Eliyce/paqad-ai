// @paqad-rule-script
// rule_id: RL-9d84
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("for\\s*\\([^)]*\\bfiles\\b", "");
const SKIP = null;
const NEED = new RegExp("--(out|limit)", "");
const FILTER = new RegExp("\\.mjs$", "");
const SEV = "info";
const MSG = "Loops over files with no --out/--limit — default to a summary for unbounded output.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-9d84', kind: 'heuristic', findings }));

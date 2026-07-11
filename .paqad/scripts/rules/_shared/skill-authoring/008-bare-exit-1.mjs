// @paqad-rule-script
// rule_id: RL-6bf1
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("process\\.exit\\(1\\)\\s*;?\\s*$", "");
const SKIP = new RegExp("(console\\.error|stderr|Usage)", "");
const NEED = null;
const FILTER = new RegExp("\\.mjs$", "");
const SEV = "info";
const MSG = "Bare exit(1) — give a clear message and the right exit code.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-6bf1', kind: 'heuristic', findings }));

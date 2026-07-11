// @paqad-rule-script
// rule_id: RL-e522
// source: docs/instructions/rules/_shared/design-system.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp(":\\s*\\d{1,4}px\\b", "");
const SKIP = new RegExp("(var\\(|token)", "");
const NEED = null;
const FILTER = new RegExp("\\.(css|scss|less)$", "");
const SEV = "info";
const MSG = "Raw px value in a stylesheet — extend the token scale instead of a one-off value.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-e522', kind: 'heuristic', findings }));

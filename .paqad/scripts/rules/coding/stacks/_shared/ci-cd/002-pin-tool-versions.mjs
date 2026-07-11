// @paqad-rule-script
// rule_id: RL-3d8c
// source: docs/instructions/rules/coding/stacks/_shared/ci-cd.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\"(eslint|prettier|typescript|vitest)\":\\s*\"(\\^|~|\\*|latest)", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("package\\.json$", "");
const SEV = "info";
const MSG = "Loose tool version range — pin tool versions so CI and local resolve the same.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3d8c', kind: 'heuristic', findings }));

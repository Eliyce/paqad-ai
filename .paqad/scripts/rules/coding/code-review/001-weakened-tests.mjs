// @paqad-rule-script
// rule_id: RL-d62a
// source: docs/instructions/rules/coding/code-review.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\b(it|test|describe)\\.skip\\b|\\bxit\\(|\\.only\\b", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "low";
const MSG = "Skipped/only test — treat missing/weakened tests as defects, not nits.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-d62a', kind: 'heuristic', findings }));

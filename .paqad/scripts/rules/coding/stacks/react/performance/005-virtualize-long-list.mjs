// @paqad-rule-script
// rule_id: RL-14c6
// source: docs/instructions/rules/coding/stacks/react/performance.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\.map\\(.*=>\\s*<", "");
const SKIP = null;
const NEED = new RegExp("(react-virtual|virtuoso|FixedSizeList|VariableSizeList)", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Rendering a mapped list directly — virtualize a long list instead of thousands of DOM nodes.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-14c6', kind: 'heuristic', findings }));

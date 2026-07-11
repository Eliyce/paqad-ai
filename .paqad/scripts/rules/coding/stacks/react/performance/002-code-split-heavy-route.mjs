// @paqad-rule-script
// rule_id: RL-71e8
// source: docs/instructions/rules/coding/stacks/react/performance.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Static import of a Page component — code-split heavy routes with React.lazy.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (/lazy/.test(text)) continue;
  lines.forEach((ln, i) => { if (/import\s+\w*[Pp]age\w*\s+from/.test(ln)) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-71e8', kind: 'heuristic', findings }));

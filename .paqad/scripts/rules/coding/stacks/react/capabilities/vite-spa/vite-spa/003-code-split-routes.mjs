// @paqad-rule-script
// rule_id: RL-62fc
// source: docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("createBrowserRouter|<Routes>", "");
const SKIP = null;
const NEED = new RegExp("(lazy\\(|React\\.lazy|import\\()", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Routes not code-split — use React.lazy/dynamic import to keep the initial chunk small.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-62fc', kind: 'heuristic', findings }));

// @paqad-rule-script
// rule_id: RL-f21c
// source: docs/instructions/rules/coding/stacks/react/ui-safety.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("(createRoot|<Routes>|createBrowserRouter)", "");
const SKIP = null;
const NEED = new RegExp("(ErrorBoundary|errorElement|componentDidCatch|getDerivedStateFromError)", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "App root without an error boundary — wrap render-time failures so one subtree does not blank the app.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-f21c', kind: 'heuristic', findings }));

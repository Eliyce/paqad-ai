// @paqad-rule-script
// rule_id: RL-c881
// source: docs/instructions/rules/coding/stacks/react/modules.md
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
const MSG = "Shared util redefined inside a feature — keep it in the shared module the map designates.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (!/\/features\//.test(file)) continue;
  lines.forEach((ln, i) => { if (/(function|const)\s+(classNames|cn|formatDate|debounce|throttle)\b/.test(ln)) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-c881', kind: 'heuristic', findings }));

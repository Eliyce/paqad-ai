// @paqad-rule-script
// rule_id: RL-265f
// source: docs/instructions/rules/coding/stacks/react/ui-safety.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("useQuery\\(", "");
const SKIP = null;
const NEED = new RegExp("(isLoading|isError|error)", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "info";
const MSG = "Async view without loading/error handling — render explicit loading/empty/error states.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-265f', kind: 'heuristic', findings }));

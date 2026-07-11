// @paqad-rule-script
// rule_id: RL-3221
// source: docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("alias", "");
const SKIP = null;
const NEED = new RegExp("@", "");
const FILTER = new RegExp("vite\\.config\\.ts$", "");
const SEV = "info";
const MSG = "Vite alias defined — mirror it in tsconfig paths so the alias set does not diverge.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3221', kind: 'heuristic', findings }));

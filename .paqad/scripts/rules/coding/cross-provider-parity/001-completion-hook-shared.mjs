// @paqad-rule-script
// rule_id: RL-93cf
// source: docs/instructions/rules/coding/cross-provider-parity.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\"Stop\"|AfterAgent", "");
const SKIP = null;
const NEED = new RegExp("native-completion-hook", "");
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "info";
const MSG = "Completion hook wired inline — render it from the shared native-completion-hook definition.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-93cf', kind: 'heuristic', findings }));

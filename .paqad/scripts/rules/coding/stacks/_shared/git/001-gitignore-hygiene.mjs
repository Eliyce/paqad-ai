// @paqad-rule-script
// rule_id: RL-3778
// source: docs/instructions/rules/coding/stacks/_shared/git.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = new RegExp("(node_modules|dist|\\.env)", "");
const FILTER = new RegExp("\\.gitignore$", "");
const SEV = "info";
const MSG = ".gitignore omits build artifacts/deps/secrets — keep them out of commits.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (!NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3778', kind: 'heuristic', findings }));

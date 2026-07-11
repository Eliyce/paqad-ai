// @paqad-rule-script
// rule_id: RL-73ed
// source: docs/instructions/rules/coding/stacks/react/security.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("target\\s*=\\s*[\"\\']_blank[\"\\']", "");
const SKIP = new RegExp("noopener", "");
const NEED = null;
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "medium";
const MSG = "target=\"_blank\" without rel=\"noopener noreferrer\" (reverse-tabnabbing).";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-73ed', kind: 'deterministic', findings }));

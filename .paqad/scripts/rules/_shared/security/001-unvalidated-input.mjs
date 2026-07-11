// @paqad-rule-script
// rule_id: RL-cf05
// source: docs/instructions/rules/_shared/security.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\breq\\.(body|query|params)\\b", "");
const SKIP = new RegExp("(parse|validate|zod|schema|safeParse)", "");
const NEED = null;
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "low";
const MSG = "External input used without validation at the boundary — validate/sanitize first.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-cf05', kind: 'heuristic', findings }));

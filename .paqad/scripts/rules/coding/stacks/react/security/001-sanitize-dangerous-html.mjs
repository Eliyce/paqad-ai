// @paqad-rule-script
// rule_id: RL-7f59
// source: docs/instructions/rules/coding/stacks/react/security.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("dangerouslySetInnerHTML", "");
const SKIP = null;
const NEED = new RegExp("(DOMPurify|sanitize)", "");
const FILTER = new RegExp("\\.(tsx|jsx)$", "");
const SEV = "high";
const MSG = "Unsanitized dangerouslySetInnerHTML — render text as children or sanitize with DOMPurify.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7f59', kind: 'heuristic', findings }));

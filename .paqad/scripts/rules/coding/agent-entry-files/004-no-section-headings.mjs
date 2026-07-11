// @paqad-rule-script
// rule_id: RL-6e28
// source: docs/instructions/rules/coding/agent-entry-files.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("^##\\s", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("(CLAUDE|AGENTS|GEMINI)\\.md$", "");
const SEV = "medium";
const MSG = "Entry file contains a `## ` section — a lean stub has none.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-6e28', kind: 'deterministic', findings }));

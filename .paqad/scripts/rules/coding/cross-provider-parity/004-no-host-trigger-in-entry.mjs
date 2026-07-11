// @paqad-rule-script
// rule_id: RL-dbc2
// source: docs/instructions/rules/coding/cross-provider-parity.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("hooks?/[\\w.-]+\\.(mjs|sh)", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("(CLAUDE|AGENTS|GEMINI)\\.md$", "");
const SEV = "info";
const MSG = "Host trigger wired via a prose entry file — host triggers belong in the hook layer.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-dbc2', kind: 'heuristic', findings }));

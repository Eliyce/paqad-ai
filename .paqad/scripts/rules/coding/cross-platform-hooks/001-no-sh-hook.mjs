// @paqad-rule-script
// rule_id: RL-4562
// source: docs/instructions/rules/coding/cross-platform-hooks.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("hooks/[\\w.-]+\\.sh", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("(claude|codex|gemini)/settings\\.json$|(codex|gemini)/hooks\\.json$", "");
const SEV = "medium";
const MSG = "A .sh hook is wired into a host config — wire only cross-platform .mjs hooks.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-4562', kind: 'deterministic', findings }));

// @paqad-rule-script
// rule_id: RL-2f32
// source: docs/instructions/rules/coding/cross-platform-hooks.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("hooks/[\\w.-]+\\.sh|~/[^\"\\n]*\\.mjs", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("(claude|codex|gemini)/settings\\.json$|(codex|gemini)/hooks\\.json$", "");
const SEV = "info";
const MSG = "Retired hook command form lingering — prune the old .sh / bare-path .mjs on re-onboard.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-2f32', kind: 'heuristic', findings }));

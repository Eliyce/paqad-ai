// @paqad-rule-script
// rule_id: RL-93ac
// source: docs/instructions/rules/coding/config-visibility.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("^\\s*(rag_enabled|paqad_enable|rule_compliance|verification|strict)\\b", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("project-profile\\.yaml$", "");
const SEV = "info";
const MSG = "Framework knob in project-profile.yaml — keep only project facts here; knobs live in the config surfaces.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-93ac', kind: 'heuristic', findings }));

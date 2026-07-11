// @paqad-rule-script
// rule_id: RL-70a6
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = null;
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("SKILL\\.md$", "");
const SEV = "medium";
const MSG = "SKILL.md frontmatter has a key outside the documented set.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const allowed = new Set(['name','description','model_tier','triggers','cacheable','cache_key_inputs','output_format','input_schema']);
  let inFm = false, seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (t.trim() === '---') { if (!inFm && seen === 0) { inFm = true; seen++; continue; } if (inFm) break; }
    if (!inFm) continue;
    const m = /^([a-z_]+):/.exec(t);
    if (m && !allowed.has(m[1])) findings.push({ file, line: i + 1, message: MSG + ' (' + m[1] + ')', severity: SEV });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-70a6', kind: 'heuristic', findings }));

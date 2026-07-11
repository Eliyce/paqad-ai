// @paqad-rule-script
// rule_id: RL-191d
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: deterministic
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
const SEV = "low";
const MSG = "SKILL.md body sections are out of the canonical order.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const order = ['## What It Does','## Use This When','## Inputs','## Procedure','## Output Contract','## Escalate / Stop Conditions','## Resources'];
  const rank = new Map(order.map((h, i) => [h, i]));
  let last = -1;
  lines.forEach((ln, i) => { const r = rank.get(ln.trim()); if (r != null) { if (r < last) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); last = r; } });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-191d', kind: 'deterministic', findings }));

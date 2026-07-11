// @paqad-rule-script
// rule_id: RL-4444
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
const SEV = "info";
const MSG = "SKILL.md description is missing or a placeholder — write it from the user perspective (activation hint).";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const d = lines.find((l) => /^description:/.test(l));
  if (!d || /^description:\s*(todo|tbd|xxx|\.\.\.|\s*$)/i.test(d)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-4444', kind: 'heuristic', findings }));

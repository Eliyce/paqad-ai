// @paqad-rule-script
// rule_id: RL-106d
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
const NEED = new RegExp("--help", "");
const FILTER = new RegExp("skills/.*/scripts/.*\\.mjs$", "");
const SEV = "low";
const MSG = "Skill script does not handle --help (must exit 0 and document usage).";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (!NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-106d', kind: 'heuristic', findings }));

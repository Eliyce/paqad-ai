// @paqad-rule-script
// rule_id: RL-18a6
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\b(parse|normalize|derive|diff|look up)\\b", "i");
const SKIP = null;
const NEED = new RegExp("scripts/", "i");
const FILTER = new RegExp("SKILL\\.md$", "i");
const SEV = "info";
const MSG = "Procedure describes a deterministic step but cites no scripts/ — route mechanical work to a script.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-18a6', kind: 'heuristic', findings }));

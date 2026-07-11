// @paqad-rule-script
// rule_id: RL-0e13
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
const FILTER = new RegExp("assets/.*\\.(txt|json)$", "");
const SEV = "info";
const MSG = "Logic in an asset file — assets are static data/templates; logic lives in scripts/.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (/\b(function\b|if\s*\(|for\s*\()/.test(ln)) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-0e13', kind: 'heuristic', findings }));

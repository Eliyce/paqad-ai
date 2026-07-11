// @paqad-rule-script
// rule_id: RL-3bbc
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
const FILTER = new RegExp("\\.mjs$", "");
const SEV = "info";
const MSG = "Script name is a grab-bag (do-stuff/util/helper/misc) — give each script one verb.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const base = file.split('/').pop() || '';
  if (/\b(do-stuff|utils?|helpers?|misc|stuff|common|index)\b/.test(base)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3bbc', kind: 'heuristic', findings }));

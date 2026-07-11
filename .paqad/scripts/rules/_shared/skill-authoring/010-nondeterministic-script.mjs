// @paqad-rule-script
// rule_id: RL-d65b
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\b(Date\\.now\\(\\)|Math\\.random\\(\\)|new Date\\(\\))", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.mjs$", "");
const SEV = "info";
const MSG = "Nondeterministic call in a script — keep scripts idempotent (stable output/ids).";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-d65b', kind: 'heuristic', findings }));

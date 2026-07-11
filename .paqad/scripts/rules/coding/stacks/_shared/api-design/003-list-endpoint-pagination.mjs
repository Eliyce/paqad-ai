// @paqad-rule-script
// rule_id: RL-04c4
// source: docs/instructions/rules/coding/stacks/_shared/api-design.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("(findAll\\(\\)|SELECT \\* FROM)", "i");
const SKIP = null;
const NEED = new RegExp("(limit|offset|page|cursor)", "i");
const FILTER = new RegExp("\\.(ts|tsx)$", "i");
const SEV = "info";
const MSG = "List endpoint with no pagination — keep pagination/error envelopes consistent.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-04c4', kind: 'heuristic', findings }));

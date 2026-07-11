// @paqad-rule-script
// rule_id: RL-585e
// source: docs/instructions/rules/coding/stacks/react/performance.md
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
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "info";
const MSG = "Sequential awaits form a request waterfall — start independent fetches in parallel.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) { if (/^\s*(const|let)\s+\w+\s*=\s*await\s+\w+\(/.test(lines[i]) && /^\s*(const|let)\s+\w+\s*=\s*await\s+\w+\(/.test(lines[i + 1])) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-585e', kind: 'heuristic', findings }));

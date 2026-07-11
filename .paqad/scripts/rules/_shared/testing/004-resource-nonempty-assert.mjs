// @paqad-rule-script
// rule_id: RL-1dc7
// source: docs/instructions/rules/_shared/testing.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("(loadPack|resolveTemplate|runtimeRoot|readFileSync)\\(", "");
const SKIP = null;
const NEED = new RegExp("(toBeGreaterThan|toContain|not\\.toHaveLength\\(0\\)|toBeTruthy|toBeDefined)", "");
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "info";
const MSG = "Loads a real shipped resource but never asserts it is non-empty — a wrong path would read as \"nothing here\".";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-1dc7', kind: 'heuristic', findings }));

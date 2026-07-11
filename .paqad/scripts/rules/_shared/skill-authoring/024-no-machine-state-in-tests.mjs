// @paqad-rule-script
// rule_id: RL-a187
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\b(execSync|child_process|https?://|playwright)\\b", "");
const SKIP = new RegExp("(mock|msw|withTempDir)", "");
const NEED = null;
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "info";
const MSG = "Test depends on developer-machine state (git/network/Playwright) — use tempdirs/fixtures.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-a187', kind: 'heuristic', findings }));

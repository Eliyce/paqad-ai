// @paqad-rule-script
// rule_id: RL-edc2
// source: docs/instructions/rules/_shared/testing.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\b(Date\\.now\\(\\)|Math\\.random\\(\\)|new Date\\(\\))", "");
const SKIP = new RegExp("(useFakeTimers|mock|fake)", "");
const NEED = null;
const FILTER = new RegExp("\\.test\\.(ts|tsx|mjs|js)$", "");
const SEV = "info";
const MSG = "Test reads the real clock/random — inject or fake it for determinism.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-edc2', kind: 'heuristic', findings }));

// @paqad-rule-script
// rule_id: RL-dae9
// source: docs/instructions/rules/_shared/skill-authoring.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("console\\.log\\([^)]*(error|warn|debug|fail)", "i");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.mjs$", "i");
const SEV = "info";
const MSG = "Diagnostic written to stdout — send diagnostics to stderr so stdout stays parseable.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-dae9', kind: 'heuristic', findings }));

// @paqad-rule-script
// rule_id: RL-7483
// source: docs/instructions/rules/coding/config-visibility.md
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
const MSG = "PAQAD_ env read outside framework-config.ts — keep knob defaults in FRAMEWORK_CONFIG_SPECS.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (/framework-config\.ts$/.test(file)) continue;
  lines.forEach((ln, i) => { if (/process\.env\.PAQAD_/.test(ln)) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7483', kind: 'heuristic', findings }));

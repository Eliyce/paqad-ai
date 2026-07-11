// @paqad-rule-script
// rule_id: RL-0a01
// source: docs/instructions/rules/coding/config-visibility.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("^\\w+=", "");
const SKIP = null;
const NEED = new RegExp("PAQAD_", "");
const FILTER = new RegExp("\\.config\\.[a-z]+$", "");
const SEV = "info";
const MSG = "Config knob without a PAQAD_* annotation/default — onboarding should write it discoverably.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-0a01', kind: 'heuristic', findings }));

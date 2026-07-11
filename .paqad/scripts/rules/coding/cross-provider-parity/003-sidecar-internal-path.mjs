// @paqad-rule-script
// rule_id: RL-f117
// source: docs/instructions/rules/coding/cross-provider-parity.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("generateConfig|installHooks", "");
const SKIP = null;
const NEED = new RegExp("(settings\\.hooks\\.json|paqad-internal)", "");
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "info";
const MSG = "Adapter emits a host config but no internal sidecar path — send installHooks metadata to a paqad-internal path.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-f117', kind: 'heuristic', findings }));

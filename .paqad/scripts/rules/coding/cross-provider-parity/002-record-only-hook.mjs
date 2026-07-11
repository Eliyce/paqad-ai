// @paqad-rule-script
// rule_id: RL-5616
// source: docs/instructions/rules/coding/cross-provider-parity.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("(AfterAgent|\"Stop\")", "");
const SKIP = null;
const NEED = new RegExp("verification-record", "");
const FILTER = new RegExp("(settings|hooks)[^/]*\\.json$", "");
const SEV = "info";
const MSG = "Non-Claude completion hook must point at the record-only script (exits 0, silent).";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-5616', kind: 'heuristic', findings }));

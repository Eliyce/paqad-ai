// @paqad-rule-script
// rule_id: RL-72e6
// source: docs/instructions/rules/coding/stacks/react/environment.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("^[A-Z][A-Z0-9_]*\\s*=\\s*\\S", "i");
const SKIP = new RegExp("=\\s*(\"?(YOUR_|<|xxx|placeholder|changeme|example))", "i");
const NEED = null;
const FILTER = new RegExp("\\.env$", "i");
const SEV = "high";
const MSG = "Committed .env secret — commit a .env.example with placeholders instead.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-72e6', kind: 'deterministic', findings }));

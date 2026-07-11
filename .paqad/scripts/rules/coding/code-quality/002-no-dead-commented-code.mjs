// @paqad-rule-script
// rule_id: RL-e3e4
// source: docs/instructions/rules/coding/code-quality.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("^\\s*//\\s*(const|let|var|function|return|if|for|while|import|export|await)\\b", "");
const SKIP = null;
const NEED = null;
const FILTER = new RegExp("\\.(ts|tsx)$", "");
const SEV = "info";
const MSG = "Commented-out/dead code — remove what you introduce.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((ln, i) => { if (RE.test(ln) && !(SKIP && SKIP.test(ln))) findings.push({ file, line: i + 1, message: MSG, severity: SEV }); });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-e3e4', kind: 'heuristic', findings }));

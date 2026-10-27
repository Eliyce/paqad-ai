// @paqad-rule-script
// rule_id: RL-3591
// source: docs/instructions/rules/coding/stacks/python-skills-plugin/build.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
function read(f) { try { return readFileSync(join(projectRoot, f), 'utf8'); } catch { return null; } }
for (const file of files) {
  const parts = file.split('/');
  const di = parts.indexOf('dist');
  if (di < 0) continue;
  const rest = parts.slice(di + 1);
  const base = parts[parts.length - 1];
  const bad = rest.some((p) => ['agents', 'hooks', 'commands', 'bin', '__pycache__'].includes(p))
    || base === 'mcp.json' || base === '.mcp.json' || base === '.app.json' || base.endsWith('.pyc');
  if (bad) {
    findings.push({ file, line: 1, message: 'forbidden file shipped in dist/', severity: 'blocker' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3591', kind: 'deterministic', findings }));

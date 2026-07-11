// @paqad-rule-script
// rule_id: RL-dfba
// source: docs/instructions/rules/coding/stacks/react/architecture.md
// kind: heuristic
// scope: changed-files
// runtime: node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
const RE = new RegExp("\\buse(State|Effect)\\(|window\\.", "");
const SKIP = null;
const NEED = new RegExp("['\"]use client['\"]", "");
const FILTER = new RegExp("app/.*\\.tsx$", "");
const SEV = "info";
const MSG = "Hooks/browser APIs without 'use client' — mark client components or keep them server-side.";
for (const file of files) {
  if (FILTER && !FILTER.test(file)) continue;
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (RE.test(text) && !NEED.test(text)) findings.push({ file, message: MSG, severity: SEV });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-dfba', kind: 'heuristic', findings }));

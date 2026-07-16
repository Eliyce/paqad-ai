// @paqad-rule-script
// rule_id: RL-73a4
// source: docs/instructions/rules/coding/feature-development.md
// kind: heuristic
// scope: changed-files
// runtime: node
// false_positive_surface: "Migration comments that mention the retired plan directory without clearly marking it retired."
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  let text; try { text = readFileSync(join(projectRoot, file), 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    if (/\.paqad\/plans\//.test(line) && !/retired|replace|legacy|hallucination|do not|must not/i.test(line)) findings.push({ file, line: i + 1, message: 'Planning artifact may target the retired .paqad/plans path instead of bundle plan.json.', severity: 'info' });
    if (/stage\s+end\s+planning/.test(line) && /--artifact/.test(line) && !/plan\.json/.test(line)) findings.push({ file, line: i + 1, message: 'Planning stage end appears to reference a non-plan.json artifact.', severity: 'info' });
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-73a4', kind: 'heuristic', findings }));

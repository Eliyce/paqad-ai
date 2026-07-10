// @paqad-rule-script
// rule_id: RL-a9d3
// source: docs/instructions/rules/coding/stacks/_shared/ci-cd.md
// kind: deterministic
// scope: whole-tree
// runtime: node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
const payload = JSON.parse(readFileSync(0, 'utf8'));
const projectRoot = payload.projectRoot;
// test fixtures deliberately contain violations — they are samples, not code
const files = payload.files.filter((f) => !/(^|\/)(__fixtures__|fixtures)(\/|$)/.test(f));
const findings = [];
const read = (rel) => { try { return readFileSync(join(projectRoot, rel), 'utf8'); } catch { return null; } };
const wf = files.filter((f) => /(^|\/)\.?github\/workflows\/[^/]+\.ya?ml$/.test(f)).sort();
if (wf.length > 0) {
  const corpus = wf.map((f) => read(f) ?? '').join('\n');
  if (!/audit|osv[- ]scanner|snyk|trivy|grype|advisor/i.test(corpus)) {
    findings.push({ file: wf[0], message: 'no CI step fails the build on high/critical dependency advisories (audit/osv-scanner/…)', severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-a9d3', kind: 'deterministic', findings }));

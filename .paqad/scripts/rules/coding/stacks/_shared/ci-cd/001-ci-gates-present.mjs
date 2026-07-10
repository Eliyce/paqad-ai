// @paqad-rule-script
// rule_id: RL-c5f0
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
  let corpus = wf.map((f) => read(f) ?? '').join('\n');
  let pkg = {};
  try { pkg = JSON.parse(read('package.json') ?? '{}'); } catch { pkg = {}; }
  const pkgScripts = pkg.scripts ?? {};
  // Expand "pnpm/npm/yarn run <script>" chains through package.json (depth-limited).
  for (let depth = 0; depth < 5; depth += 1) {
    let grew = false;
    for (const m of corpus.matchAll(/(?:pnpm|npm|yarn)(?:\s+-[^\s]+)*\s+(?:run\s+)?([a-z0-9:_-]+)/g)) {
      const target = pkgScripts[m[1]];
      if (target && !corpus.includes('\u0000' + m[1] + '\u0000')) { corpus += '\n\u0000' + m[1] + '\u0000 ' + target; grew = true; }
    }
    if (!grew) break;
  }
  const GATES = [
    ['format', /prettier|format|fmt\b/i],
    ['lint', /eslint|\blint\b/i],
    ['test', /vitest|jest|pytest|\btest\b/i],
    ['build', /\bbuild\b|tsup|vite build|tsc\b/i],
  ];
  for (const [gate, re] of GATES) {
    if (!re.test(corpus)) findings.push({ file: wf[0], message: `CI workflows never run the ${gate} gate that blocks local delivery`, severity: 'high' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-c5f0', kind: 'deterministic', findings }));

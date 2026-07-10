// @paqad-rule-script
// rule_id: RL-3d8c
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
for (const file of files) {
  if (file !== 'package.json') continue;
  let pkg;
  try { pkg = JSON.parse(read(file) ?? ''); } catch { continue; }
  const LOCKS = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'];
  const hasLock = LOCKS.some((l) => files.includes(l) || existsSync(join(projectRoot, l)));
  if (!hasLock) findings.push({ file, message: 'no lockfile committed alongside package.json — CI and local resolve different dependency trees', severity: 'high' });
  if (!pkg.engines?.node && !pkg.packageManager && !pkg.volta) {
    findings.push({ file, message: 'tool versions not pinned (no engines.node, packageManager, or volta field)', severity: 'medium' });
  }
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-3d8c', kind: 'deterministic', findings }));

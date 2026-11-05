#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { escapeControlBytes, PLUGIN_PACKAGE_KEYS } from './assemble-plugin.mjs';

export const SELF_IMPORTS = ['paqad-ai', 'paqad-ai/rule-scripts'];

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.name === '.git') return [];
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function hasTypesCondition(value) {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([condition, target]) => condition === 'types' || hasTypesCondition(target),
  );
}

export function selfImportScriptsDir(tree) {
  const skills = join(tree, 'runtime', 'base', 'skills');
  const found = readdirSync(skills)
    .map((skill) => join(skills, skill, 'scripts'))
    .find((dir) => existsSync(dir));
  if (found === undefined)
    throw new Error('no skill under runtime/base/skills has a scripts folder.');
  return found;
}

export function runSelfImports(tree) {
  const scripts = selfImportScriptsDir(tree);
  const probe = join(scripts, '.plugin-tree-probe.mjs');
  writeFileSync(
    probe,
    SELF_IMPORTS.map(
      (name) =>
        `console.log(${JSON.stringify(name)}, Object.keys(await import(${JSON.stringify(name)})).length);`,
    ).join('\n'),
  );
  try {
    return execFileSync(process.execPath, [probe], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: scripts,
    });
  } finally {
    rmSync(probe, { force: true });
  }
}

export function checkPluginTree(tree) {
  const root = resolve(tree);
  const problems = [];
  const paths = filesUnder(root).map((path) => relative(root, path).split(sep).join('/'));
  for (const path of paths) {
    if (path.startsWith('dist/') && path.endsWith('.d.ts')) {
      problems.push(`${path} is a type file under dist.`);
    }
    if (path.endsWith('.js') && escapeControlBytes(readFileSync(join(root, path))) !== null) {
      problems.push(`${path} holds a raw control byte.`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const keys = Object.keys(pkg).join(', ');
  if (keys !== PLUGIN_PACKAGE_KEYS.join(', ')) {
    problems.push(`package.json has the keys ${keys}, not ${PLUGIN_PACKAGE_KEYS.join(', ')}.`);
  }
  if (hasTypesCondition(pkg.exports)) problems.push('package.json exports has a types condition.');
  try {
    runSelfImports(root);
  } catch (error) {
    const detail =
      error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : String(error);
    problems.push(`The self-imports failed. ${detail}`);
  }
  return problems;
}

function isDirectRun() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isDirectRun()) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/check-plugin-tree.mjs <assembled plugin folder>');
    process.exit(1);
  }
  const problems = checkPluginTree(target);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`The plugin tree in ${target} passed.`);
}

#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_TREE = [
  '.claude-plugin/plugin.json',
  'package.json',
  'dist',
  'runtime',
  'README.md',
  'LICENSE',
];

const KEEP_IN_OUTPUT = new Set(['.git']);

function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function isShippedRuntimeFile(runtimeRoot, path) {
  const rel = relative(runtimeRoot, path).split(sep).join('/');
  if (rel.startsWith('..') || !rel.startsWith('claude-plugin/mod')) return true;
  if (rel === 'claude-plugin/mod/test' || rel.startsWith('claude-plugin/mod/test/')) return false;
  return !/\.test\.tsx?$/.test(rel);
}

export function assemblePlugin({ repoRoot, outDir }) {
  const root = resolve(repoRoot);
  const out = resolve(outDir);
  if (out === root || root.startsWith(`${out}${sep}`)) {
    throw new Error('The output folder must not hold the repository.');
  }
  for (const name of PLUGIN_TREE) {
    if (!existsSync(join(root, name))) {
      throw new Error(`${name} is missing. Run pnpm build first.`);
    }
  }
  const packageVersion = readVersion(join(root, 'package.json'));
  const pluginVersion = readVersion(join(root, '.claude-plugin', 'plugin.json'));
  if (packageVersion === null || packageVersion !== pluginVersion) {
    throw new Error(
      `plugin.json is at ${pluginVersion ?? 'no version'} but package.json is at ${packageVersion ?? 'no version'}. Run pnpm build first.`,
    );
  }
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(out)) {
    if (!KEEP_IN_OUTPUT.has(name)) rmSync(join(out, name), { recursive: true, force: true });
  }
  const runtimeRoot = join(root, 'runtime');
  for (const name of PLUGIN_TREE) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    cpSync(join(root, name), join(out, name), {
      recursive: true,
      filter: (path) => isShippedRuntimeFile(runtimeRoot, path),
    });
  }
  return { version: packageVersion, outDir: out };
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
    console.error('Usage: node scripts/assemble-plugin.mjs <output folder>');
    process.exit(1);
  }
  try {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const result = assemblePlugin({ repoRoot, outDir: target });
    console.log(`Assembled paqad plugin v${result.version} in ${result.outDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

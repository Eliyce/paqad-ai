#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_TREE = [
  '.claude-plugin/plugin.json',
  'package.json',
  'dist',
  'runtime',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'assets/icon.png',
];

export const PLUGIN_REPO = 'Eliyce/paqad-claude-plugin';

export const PLUGIN_MARKETPLACE = {
  name: 'eliyce',
  owner: { name: 'Eliyce' },
  description: 'paqad for Claude Code',
  metadata: {
    description:
      "paqad for Claude Code: your team's rules, enforced at edit time, with evidence for every change.",
  },
  plugins: [
    {
      name: 'paqad',
      displayName: 'paqad',
      source: './',
      description: "Your team's rules, enforced at edit time, with evidence for every change.",
      category: 'governance',
      homepage: 'https://paqad.ai',
      keywords: ['governance', 'code-review', 'evidence', 'rules', 'quality-gates', 'compliance'],
    },
  ],
};

const KEEP_IN_OUTPUT = new Set(['.git']);

export const NEVER_SHIPPED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);

function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function isShippedFile(runtimeRoot, distPluginRoot, path) {
  if (NEVER_SHIPPED.has(basename(path)) || path.endsWith('.map')) return false;
  if (path === distPluginRoot || path.startsWith(`${distPluginRoot}${sep}`)) return false;
  const rel = relative(runtimeRoot, path).split(sep).join('/');
  if (rel.startsWith('..') || !rel.startsWith('claude-plugin/mod')) return true;
  if (rel === 'claude-plugin/mod/test' || rel.startsWith('claude-plugin/mod/test/')) return false;
  return !/\.test\.tsx?$/.test(rel);
}

function isControlByte(byte) {
  return (
    (byte >= 0x01 && byte <= 0x08) ||
    byte === 0x0b ||
    byte === 0x0c ||
    (byte >= 0x0e && byte <= 0x1f)
  );
}

export function escapeControlBytes(bytes) {
  if (!bytes.some(isControlByte)) return null;
  const out = [];
  for (const byte of bytes) {
    if (isControlByte(byte)) out.push(...Buffer.from(`\\x${byte.toString(16).padStart(2, '0')}`));
    else out.push(byte);
  }
  return Buffer.from(out);
}

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (KEEP_IN_OUTPUT.has(entry.name)) return [];
    if (entry.isDirectory()) return jsFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

function escapeTreeControlBytes(out) {
  for (const path of jsFiles(out)) {
    const escaped = escapeControlBytes(readFileSync(path));
    if (escaped === null) continue;
    writeFileSync(path, escaped);
    try {
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
    } catch (error) {
      const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
      throw new Error(
        `${relative(out, path)} does not parse after its control bytes were escaped.${detail ? ` ${detail}` : ''}`,
        { cause: error },
      );
    }
  }
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
  const distPluginRoot = join(root, 'dist', 'plugin');
  for (const name of PLUGIN_TREE) {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    cpSync(join(root, name), join(out, name), {
      recursive: true,
      filter: (path) => isShippedFile(runtimeRoot, distPluginRoot, path),
    });
  }
  escapeTreeControlBytes(out);
  writeFileSync(
    join(out, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(PLUGIN_MARKETPLACE, null, 2)}\n`,
  );
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
    console.error(
      `Usage: node scripts/assemble-plugin.mjs <output folder, a clone of ${PLUGIN_REPO}>`,
    );
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

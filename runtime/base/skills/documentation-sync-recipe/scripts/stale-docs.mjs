#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const MAX_ERRORS = 100;

function finish(input, errors, extra = {}) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ input, errors, ...extra }))
    .digest('hex');
  const shown =
    errors.length > MAX_ERRORS
      ? [...errors.slice(0, MAX_ERRORS), `and ${errors.length - MAX_ERRORS} more`]
      : errors;
  process.stdout.write(
    `${JSON.stringify({ ok: errors.length === 0, errors: shown, hash, ...extra })}\n`,
  );
  process.exitCode = errors.length === 0 ? 0 : 1;
}

import { join, relative } from 'node:path';

const CANONICAL = new Set([
  'README.md',
  'endpoints.md',
  'schemas.md',
  'error-codes.md',
  'events.md',
  'contracts.md',
  'state.md',
  'workflows.md',
  'summary.md',
]);

function docsUnder(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) docsUnder(path, found);
    else if (CANONICAL.has(entry.name)) found.push(path);
  }
  return found;
}

const MODULE_MAP = 'docs/instructions/rules/module-map.yml';

function cleanSource(value) {
  return value
    .trim()
    .replace(/^['"]|['"]$/gu, '')
    .replace(/\/$/u, '');
}

// Only the slug and every sources list are needed, so a script with no packages can read them.
function readModuleSources(root) {
  let text;
  try {
    text = readFileSync(join(root, MODULE_MAP), 'utf8');
  } catch {
    return new Map();
  }
  const modules = new Map();
  let current = null;
  let listIndent = null;
  for (const line of text.split('\n')) {
    const slug = /^ {2}- slug:\s*(\S+)\s*$/u.exec(line);
    if (slug) {
      current = [];
      modules.set(cleanSource(slug[1]), current);
      listIndent = null;
      continue;
    }
    if (current === null) continue;
    const item = /^(\s*)- (\S+)\s*$/u.exec(line);
    if (listIndent !== null && item && item[1].length >= listIndent) {
      current.push(cleanSource(item[2]));
      continue;
    }
    listIndent = null;
    const key = /^(\s*)sources:\s*(?:\[(.*)\])?\s*$/u.exec(line);
    if (!key) continue;
    if (key[2] === undefined) listIndent = key[1].length;
    else current.push(...key[2].split(',').map(cleanSource).filter(Boolean));
  }
  return modules;
}

function isSourceFile(file) {
  return (
    !file.startsWith('docs/') &&
    !file.startsWith('.') &&
    !/(^|\/)(tests?|__tests__)\//u.test(file) &&
    !/\.(test|spec)\.[^./]+$/u.test(file)
  );
}

function namesModule(file, module) {
  return file.includes(`/${module}/`) || file.includes(`/${module}.`);
}

function underSource(file, source) {
  return file === source || file.startsWith(`${source}/`);
}

function staleDocs(root, changed, acknowledged) {
  const base = join(root, 'docs/modules');
  const changedSet = new Set(changed);
  const sources = readModuleSources(root);
  const code = changed.filter(isSourceFile);
  const stale = new Set();
  for (const doc of docsUnder(base).map((path) => relative(root, path).replaceAll('\\', '/'))) {
    const module = doc.split('/')[2];
    if (changedSet.has(doc) || acknowledged.has(doc)) continue;
    const owned = sources.get(module) ?? [];
    if (
      code.some(
        (file) => namesModule(file, module) || owned.some((source) => underSource(file, source)),
      )
    ) {
      stale.add(doc);
    }
  }
  return [...stale].sort();
}

const args = process.argv.slice(2);
if (args[0] === '--help') {
  process.stdout.write(
    'usage: stale-docs.mjs [project-root] [--ok <doc>]... < changed-files\nprints { ok, errors, hash, stale }\n',
  );
} else {
  const acknowledged = new Set();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--ok') acknowledged.add(args[(index += 1)]);
    else positional.push(args[index]);
  }
  const root = positional[0] ?? process.cwd();
  if (acknowledged.has(undefined) || positional.length > 1 || root.startsWith('--')) {
    process.stderr.write('stale-docs.mjs: expected [project-root] [--ok <doc>]...\n');
    process.exit(2);
  }
  if (!existsSync(root)) {
    process.stderr.write(`stale-docs.mjs: project root not found: ${root}\n`);
    process.exit(2);
  }
  const input = readFileSync(0, 'utf8');
  const changed = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const stale = staleDocs(root, changed, acknowledged);
  finish(
    input,
    stale.map((doc) => `${doc} may be stale: update it or name it with --stale-ok`),
    { stale },
  );
}

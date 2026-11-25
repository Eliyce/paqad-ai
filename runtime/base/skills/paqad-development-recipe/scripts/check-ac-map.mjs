#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_ERRORS = 100;
const SKIP = new Set([
  'node_modules',
  'dist',
  '.git',
  '.paqad',
  'coverage',
  'build',
  'target',
  'vendor',
  'bin',
  'obj',
  'venv',
  '.venv',
  '.tox',
  '.gradle',
  '__pycache__',
  '__snapshots__',
  'fixtures',
]);
const TEST_NAME =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?|_(?:test|spec)\.[a-z]+|(?:^|\/)test_[^/]+\.(?:py|rb)|(?:Tests?|Spec|IT)\.(?:java|kt|kts|groovy|scala|cs|fs|vb|php|swift|cc|cpp)|(?:^|\/)Test[A-Z][^/]*\.(?:java|kt|cs))$/u;
const IN_TEST_FOLDER =
  /(?:^|\/)(?:tests?|specs?|__tests__)\/.*\.(?:py|rb|java|kt|kts|groovy|scala|cs|fs|go|rs|php|swift|exs?|dart|c|cc|cpp|[cm]?[jt]sx?)$/u;
const RUST_TEST = /#\[(?:cfg\(test\)|[a-z_:]*test)\]/u;

function stopWith(code, message) {
  process.stderr.write(`check-ac-map.mjs: ${message}\n`);
  process.exitCode = code;
}

function readInput(file, expected) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    stopWith(2, `file not found: ${file}. Expected ${expected}.`);
    return null;
  }
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    stopWith(1, 'the input is not valid JSON.');
    return null;
  }
  stopWith(1, 'the input is not a JSON object.');
  return null;
}

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

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isTestPath(path, read) {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => SKIP.has(part))) return false;
  if (TEST_NAME.test(normalized) || IN_TEST_FOLDER.test(normalized)) return true;
  return normalized.endsWith('.rs') && RUST_TEST.test(read() ?? '');
}

function allTestTexts(root, dir = root, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      allTestTexts(root, path, found);
    } else if (isTestPath(relative(root, path), () => readText(path))) {
      const text = readText(path);
      if (text !== null) found.push(text);
    }
  }
  return found;
}

function criterionPattern(id) {
  const number = /^AC-(\d+)$/u.exec(id)?.[1];
  if (number === undefined) {
    const literal = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?<![\\w-])${literal}(?![0-9]|\\.[0-9])`, 'u');
  }
  return new RegExp(
    `(?:(?<![A-Za-z0-9])[Aa][Cc][-_]?|(?<=[a-z0-9])A[Cc]_?)${number}(?![0-9]|\\.[0-9])`,
    'u',
  );
}

function missingCriteria(spec, text, message) {
  return (spec.acceptance_criteria ?? [])
    .filter((criterion) => (criterion.proof_type ?? 'automated') === 'automated')
    .map((criterion) => criterion.criterion_id ?? criterion.id)
    .filter((id) => !criterionPattern(id).test(text))
    .map((id) => `${id} ${message}`);
}

function addedTestLines(root) {
  const added = JSON.parse(readFileSync(0, 'utf8'));
  return Object.entries(added)
    .filter(([path]) => isTestPath(path, () => readText(join(root, path))))
    .map(([, text]) => text)
    .join('\n');
}

function check(input, spec, root, addedOnly) {
  const all = allTestTexts(root);
  if (all.length === 0) {
    finish(input, [], { unchecked: `no test file could be read under ${root}` });
    return;
  }
  if (addedOnly) {
    finish(
      input,
      missingCriteria(spec, addedTestLines(root), 'has no test line added by this change'),
      { scope: 'added' },
    );
    return;
  }
  finish(input, missingCriteria(spec, all.join('\n'), 'has no test that names it'), {
    scope: 'all-tests',
  });
}

const args = process.argv.slice(2);
const addedOnly = args.includes('--added-stdin');
const [file, root] = args.filter((arg) => arg !== '--added-stdin');
if (!file || file === '--help') {
  process.stdout.write(
    'usage: check-ac-map.mjs <specification.json> [project-root] [--added-stdin]\n' +
      'prints { ok, errors, hash, scope } and, when no test can be read, { unchecked }\n' +
      '--added-stdin reads { path: added lines } as JSON and counts only those lines\n',
  );
  process.exitCode = file ? 0 : 2;
} else {
  const text = readInput(file, 'a specification.json file');
  const spec = text === null ? null : parseJson(text);
  if (spec !== null) check(text, spec, root ?? process.cwd(), addedOnly);
}

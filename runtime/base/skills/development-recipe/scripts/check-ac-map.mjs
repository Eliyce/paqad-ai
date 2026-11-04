#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_ERRORS = 100;

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

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git', '.paqad', 'coverage', 'build']);
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|_test\.(go|py)|Test\.php)$/u;

function testFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(path, found);
    else if (TEST_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

function check(spec, root) {
  const criteria = (spec.acceptance_criteria ?? []).filter(
    (criterion) => (criterion.proof_type ?? 'automated') === 'automated',
  );
  const text = testFiles(root)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  return criteria
    .map((criterion) => criterion.criterion_id ?? criterion.id)
    .filter((id) => !new RegExp(`\\b${id}(?![\\d.])`, 'u').test(text))
    .map((id) => `${id} has no test that names it`);
}

const [file, root] = process.argv.slice(2);
if (!file || file === '--help') {
  process.stdout.write(
    'usage: check-ac-map.mjs <specification.json> [project-root]\nprints { ok, errors, hash }\n',
  );
  process.exitCode = file ? 0 : 2;
} else {
  const text = readInput(file, 'a specification.json file');
  const spec = text === null ? null : parseJson(text);
  if (spec !== null) finish(text, check(spec, root ?? process.cwd()));
}

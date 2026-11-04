#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function finish(input, errors, extra = {}) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ input, errors, ...extra }))
    .digest('hex');
  process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, errors, hash, ...extra })}\n`);
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
  const text = testFiles(root).map((file) => readFileSync(file, 'utf8')).join('\n');
  return criteria
    .filter((criterion) => !new RegExp(`\\b${criterion.id}(?![\\d.])`, 'u').test(text))
    .map((criterion) => `${criterion.id} has no test that names it`);
}

const [file, root] = process.argv.slice(2);
if (!file || file === '--help') {
  process.stdout.write('usage: check-ac-map.mjs <specification.json> [project-root]\nprints { ok, errors, hash }\n');
  process.exitCode = file ? 0 : 2;
} else {
  const text = readFileSync(file, 'utf8');
  finish(text, check(JSON.parse(text), root ?? process.cwd()));
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_ERRORS = 100;

function stopWith(code, message) {
  process.stderr.write(`check-spec.mjs: ${message}\n`);
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

const CRITERION = /^-\s*(AC-[^:\s]+):\s*(.*)$/u;
const FLAT_ID = /^AC-\d+$/u;

function section(lines, heading) {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

function check(text) {
  const errors = [];
  const lines = text.split('\n');
  const criteria = section(lines, '## acceptance criteria');
  if (criteria === null) return ['the spec has no "## Acceptance criteria" section'];
  const seen = new Set();
  let found = 0;
  for (const line of criteria) {
    const match = CRITERION.exec(line);
    if (!match) continue;
    found += 1;
    const [, id, body] = match;
    if (!FLAT_ID.test(id)) errors.push(`${id} is not a flat AC-N id`);
    if (seen.has(id)) errors.push(`${id} appears twice`);
    seen.add(id);
    if (!/\bgiven\b/iu.test(body) || !/\bwhen\b/iu.test(body) || !/\bthen\b/iu.test(body)) {
      errors.push(`${id} is not in given, when, then form`);
    }
  }
  if (found === 0) errors.push('the spec has no AC-N criteria');
  if (section(lines, '## edge cases') === null && !text.includes('No Additional Edge Cases')) {
    errors.push('the spec has no "## Edge cases" section');
  }
  return errors;
}

const file = process.argv[2];
if (!file || file === '--help') {
  process.stdout.write('usage: check-spec.mjs <spec.md>\nprints { ok, errors, hash }\n');
  process.exitCode = file ? 0 : 2;
} else {
  const text = readInput(file, 'a spec Markdown file');
  if (text !== null) finish(text, check(text));
}

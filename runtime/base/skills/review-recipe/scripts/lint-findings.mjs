#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_ERRORS = 100;

function stopWith(code, message) {
  process.stderr.write(`lint-findings.mjs: ${message}\n`);
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

const RANKS = new Map([
  ['Critical', 1],
  ['High', 2],
  ['Medium', 3],
  ['Low', 4],
]);
const JSON_RANKS = new Map([
  ['blocker', 1],
  ['major', 2],
  ['minor', 3],
]);

function lintMarkdown(body) {
  const errors = [];
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## Findings'));
  if (start === -1) errors.push('missing "## Findings" heading');
  const rest = start === -1 ? [] : lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const findings = (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith('- '));
  if (findings.length === 0) errors.push('no finding bullets ("- ...") under "## Findings"');
  let last = 0;
  findings.forEach((line, index) => {
    const name = `finding ${index + 1}`;
    const tag = /\b(Critical|High|Medium|Low)\b/u.exec(line)?.[1];
    if (!tag) {
      errors.push(`${name} has no severity tag`);
      return;
    }
    const rank = RANKS.get(tag);
    if (rank < last) errors.push(`severity out of order at: ${name}`);
    last = rank;
    if (!line.includes('Required action:')) {
      errors.push(`${name} has no 'Required action:' segment`);
    }
  });
  return errors;
}

function lintTemplate(template) {
  const errors = [];
  const findings = Array.isArray(template.findings) ? template.findings : [];
  let last = 0;
  findings.forEach((finding, index) => {
    const name = `finding ${index + 1}`;
    const rank = JSON_RANKS.get(finding?.severity);
    if (rank === undefined) {
      errors.push(`${name} has no severity of blocker, major or minor`);
      return;
    }
    if (rank < last) errors.push(`severity out of order at: ${name}`);
    last = rank;
    if (typeof finding.description !== 'string' || finding.description.trim() === '') {
      errors.push(`${name} has no description`);
    }
  });
  return errors;
}

const file = process.argv[2];
if (!file || file === '--help') {
  process.stdout.write(
    'usage: lint-findings.mjs <review-template.json | findings.md>\nprints { ok, errors, hash }\n',
  );
  process.exitCode = file ? 0 : 2;
} else {
  const text = readInput(file, 'a review template JSON or findings Markdown file');
  if (text !== null && file.endsWith('.json')) {
    const template = parseJson(text);
    if (template !== null) finish(text, lintTemplate(template));
  } else if (text !== null) {
    finish(text, lintMarkdown(text));
  }
}

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

import { fileURLToPath } from 'node:url';

const RANKS_FILE = fileURLToPath(new URL('../../adversarial-review/assets/severity-ranks.txt', import.meta.url));
const RANKS = new Map(
  readFileSync(RANKS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .map(([name, rank]) => [name, Number(rank)]),
);
const JSON_RANKS = new Map([['blocker', 1], ['major', 2], ['minor', 3]]);

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
  for (const line of findings) {
    const tag = /\b(Critical|High|Medium|Low)\b/u.exec(line)?.[1];
    if (!tag) {
      errors.push(`finding missing severity tag: ${line}`);
      continue;
    }
    const rank = RANKS.get(tag);
    if (rank < last) errors.push(`severity out of order at: ${line}`);
    last = rank;
    if (!line.includes('Required action:')) {
      errors.push(`finding missing 'Required action:' segment: ${line}`);
    }
  }
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
  process.stdout.write('usage: lint-findings.mjs <review-template.json | findings.md>\nprints { ok, errors, hash }\n');
  process.exitCode = file ? 0 : 2;
} else {
  const text = readFileSync(file, 'utf8');
  finish(text, file.endsWith('.json') ? lintTemplate(JSON.parse(text)) : lintMarkdown(text));
}

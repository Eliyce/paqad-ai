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

const VERDICTS = new Set(['ac-satisfying', 'necessary-setup', 'scaffolding', 'over-build']);

function check(plan) {
  const errors = [];
  const reuse = plan.reuse;
  if (!reuse || typeof reuse !== 'object' || !Array.isArray(reuse.consulted)) {
    errors.push('the plan has no reuse section with a consulted list');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('the plan has no steps');
    return errors;
  }
  plan.steps.forEach((step, index) => {
    const name = step?.id ?? `step ${index + 1}`;
    if (!VERDICTS.has(step?.classification)) {
      errors.push(
        `${name} has no keep-or-drop verdict: set classification to one of ${[...VERDICTS].join(', ')}`,
      );
    }
  });
  return errors;
}

const file = process.argv[2];
if (!file || file === '--help') {
  process.stdout.write('usage: check-plan.mjs <plan-template.json>\nprints { ok, errors, hash }\n');
  process.exitCode = file ? 0 : 2;
} else {
  const text = readFileSync(file, 'utf8');
  finish(text, check(JSON.parse(text)));
}

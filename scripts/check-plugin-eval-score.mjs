#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { formatSuite, judgeSuite, suiteScore } from './lib/plugin-eval-score.mjs';

function parseArgs(argv) {
  const args = { min: null, gated: [], reported: [], errors: [] };
  const pair = (value) => {
    const at = value.indexOf('=');
    return at > 0 && at < value.length - 1
      ? { suite: value.slice(0, at), path: value.slice(at + 1) }
      : null;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--min' || arg === '--report-only') {
      const value = argv[++i];
      if (value === undefined) {
        args.errors.push(`${arg} needs a value`);
      } else if (arg === '--min') {
        args.min = Number(value);
      } else if (pair(value)) {
        args.reported.push(pair(value));
      } else {
        args.errors.push(`--report-only expects <suite>=<json>, got "${value}"`);
      }
    } else if (pair(arg)) {
      args.gated.push(pair(arg));
    } else {
      args.errors.push(`expected <suite>=<json>, got "${arg}"`);
    }
  }
  if (args.min === null || !Number.isFinite(args.min) || args.min < 0 || args.min > 1) {
    args.errors.push('--min must be a number from 0 to 1');
  }
  if (args.gated.length === 0 && args.reported.length === 0) {
    args.errors.push('name at least one <suite>=<json>');
  }
  return args;
}

function checkSuite({ suite, path }, min, gated) {
  if (!existsSync(path)) {
    process.stdout.write(`${suite}: ${gated ? 'FAIL' : 'NO SCORE'} (no result file at ${path})\n`);
    return false;
  }
  let score;
  try {
    score = suiteScore(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    process.stdout.write(`${suite}: ${gated ? 'FAIL' : 'NO SCORE'} (${path}: ${error.message})\n`);
    return false;
  }
  const verdict = judgeSuite(score, min);
  for (const line of formatSuite(suite, score, verdict, gated)) {
    process.stdout.write(`${line}\n`);
  }
  return verdict.ok;
}

const args = parseArgs(process.argv.slice(2));
if (args.errors.length > 0) {
  for (const error of args.errors) process.stderr.write(`check-plugin-eval-score: ${error}\n`);
  process.exit(1);
}
let ok = true;
for (const entry of args.gated) {
  ok = checkSuite(entry, args.min, true) && ok;
}
for (const entry of args.reported) {
  checkSuite(entry, args.min, false);
}
process.exit(ok ? 0 : 1);

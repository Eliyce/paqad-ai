#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  budgetSummary,
  budgetWarnings,
  escapeAnnotation,
  summariseShard,
  timingCoverage,
  timingCoverageError,
  timingCoverageSummary,
} from './lib/shard-budget.mjs';

function parseArgs(argv) {
  const args = {
    dir: '.vitest-durations',
    os: process.platform,
    platform: process.platform,
    root: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (['--dir', '--os', '--platform', '--root'].includes(arg) && value !== undefined) {
      args[arg.slice(2)] = value;
      i++;
    } else {
      process.stdout.write(`Ignoring unknown or incomplete argument "${arg}".\n`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir);
const shards = [];
const names = existsSync(dir) ? readdirSync(dir).sort() : [];
for (const name of names) {
  const match = /^durations-(.+)\.json$/.exec(name);
  if (!match) continue;
  try {
    shards.push(
      summariseShard(
        match[1],
        JSON.parse(readFileSync(join(dir, name), 'utf8')),
        resolve(args.root),
      ),
    );
  } catch (error) {
    process.stdout.write(
      `::warning title=Shard budget::${escapeAnnotation(`Could not read ${name}: ${error.message}`)}\n`,
    );
  }
}
for (const line of [...budgetSummary(shards, args.os), ...budgetWarnings(shards, args.os)]) {
  process.stdout.write(`${line}\n`);
}
if (shards.length === 0) process.exit(0);
let timings = {};
try {
  timings = JSON.parse(
    readFileSync(join(resolve(args.root), 'tests', 'shard-timings.json'), 'utf8'),
  );
} catch (error) {
  process.stdout.write(
    `Could not read tests/shard-timings.json, so no file has a timing: ${error.message}\n`,
  );
}
const coverage = timingCoverage(shards, timings, args.platform);
process.stdout.write(`${timingCoverageSummary(coverage, args.os)}\n`);
const error = timingCoverageError(coverage, args.os);
if (error) process.stdout.write(`${error}\n`);
process.exit(error ? 1 : 0);

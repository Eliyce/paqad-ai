#!/usr/bin/env node
// Warns when an OS's CI test shards drift past their time budget (issue #654). Runs in each
// `merge` job of .github/workflows/ci.yml after the shards are merged.
//
//   node scripts/check-shard-budget.mjs [--dir <dir>] [--os <label>] [--root <dir>]
//
// Reads every `durations-<shard>.json` (a vitest JSON report one shard wrote) in --dir (default
// .vitest-durations), prints one line per shard, and prints a GitHub `::warning::` when the
// slowest shard ran over 270s or a single test file over 90s. It never fails the build: it always
// exits 0, also when no reports are found, so a missing report cannot turn a gate red.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  budgetSummary,
  budgetWarnings,
  escapeAnnotation,
  summariseShard,
} from './lib/shard-budget.mjs';

function parseArgs(argv) {
  const args = { dir: '.vitest-durations', os: process.platform, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '--dir' || arg === '--os' || arg === '--root') && value !== undefined) {
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
process.exit(0);

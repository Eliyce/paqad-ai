#!/usr/bin/env node

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

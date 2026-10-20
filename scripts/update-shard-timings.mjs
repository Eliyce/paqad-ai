#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  durationsFromReports,
  mergeTimings,
  PLATFORMS,
  serializeTimings,
} from './lib/shard-timings.mjs';

const USAGE =
  'Usage: node scripts/update-shard-timings.mjs --report <file> [--report <file> ...] [--platform win32|linux|darwin] [--root <dir>]';

function fail(message) {
  process.stderr.write(`Error: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { reports: [], platform: process.platform, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--report' || arg === '--platform' || arg === '--root') {
      if (value === undefined) fail(`${arg} requires a value.`);
      i++;
      if (arg === '--report') args.reports.push(value);
      else if (arg === '--platform') args.platform = value;
      else args.root = value;
    } else {
      fail(`unknown argument "${arg}".`);
    }
  }
  if (args.reports.length === 0) fail('at least one --report is required.');
  if (!PLATFORMS.includes(args.platform)) fail(`unknown platform "${args.platform}".`);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root);
const reports = args.reports.map((file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`cannot read report ${file}: ${error.message}`);
  }
});
const durations = durationsFromReports(reports, root);
const target = join(root, 'tests', 'shard-timings.json');
let existing;
try {
  existing = JSON.parse(readFileSync(target, 'utf8'));
} catch {
  existing = {};
}
writeFileSync(target, serializeTimings(mergeTimings(existing, args.platform, durations)));
process.stdout.write(
  `Wrote ${Object.keys(durations).length} ${args.platform} timings to tests/shard-timings.json\n`,
);

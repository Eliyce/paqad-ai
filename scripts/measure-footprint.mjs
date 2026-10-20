#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  aggregateFootprint,
  buildFootprintReport,
  discoverFootprintFiles,
  renderFootprintMarkdown,
} from './lib/footprint.mjs';

const DEFAULT_TOKENIZER = 'Xenova/gpt2';

function parseArgs(argv) {
  const args = { project: process.cwd(), tokenizer: DEFAULT_TOKENIZER, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--project') {
      args.project = argv[++i];
    } else if (arg === '--tokenizer') {
      args.tokenizer = argv[++i];
    } else {
      process.stderr.write(`Error: unknown argument "${arg}".\n${USAGE}\n`);
      process.exit(2);
    }
    if ((arg === '--project' || arg === '--tokenizer') && args[arg.slice(2)] === undefined) {
      process.stderr.write(`Error: ${arg} requires a value.\n${USAGE}\n`);
      process.exit(2);
    }
  }
  return args;
}

const USAGE =
  'Usage: node scripts/measure-footprint.mjs [--project <path>] [--tokenizer <version>] [--json]';

function heuristicCounter() {
  return { countTokens: (text) => Math.ceil(text.length / 4), tokenizer_version: 'heuristic' };
}

async function loadTokenizer(version) {
  try {
    const distUrl = new URL('../dist/context/tokenizer-cache.js', import.meta.url);
    const { getOrLoad } = await import(distUrl.href);
    return await getOrLoad(version);
  } catch {
    return heuristicCounter();
  }
}

function shortCommit(projectRoot) {
  try {
    return execFileSync('git', ['-C', projectRoot, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.project);
  const tokenizer = await loadTokenizer(args.tokenizer);

  const records = discoverFootprintFiles(projectRoot);
  const aggregate = aggregateFootprint(records, (text) => tokenizer.countTokens(text));
  const meta = {
    project: projectRoot,
    commit: shortCommit(projectRoot),
    tokenizerVersion: tokenizer.tokenizer_version,
    date: new Date().toISOString().slice(0, 10),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildFootprintReport(aggregate, meta), null, 2)}\n`);
  } else {
    process.stdout.write(`${renderFootprintMarkdown(aggregate, meta)}\n`);
  }
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});

#!/usr/bin/env node
// Measure the resident session-start footprint paqad adds to a project (issue #285,
// headline a). Read-only. Runs in whatever project it is pointed at — the paqad-ai
// repo (dogfood) or a fresh onboarded fixture — never mutating anything.
//
//   node scripts/measure-footprint.mjs [--project <path>] [--tokenizer <version>] [--json]
//
// --project defaults to the current directory. --json prints only the JSON report.
// Token counts use src/context/tokenizer-cache.ts (real tokenizer when
// @xenova/transformers is installed, else a labelled char/4 heuristic). Exit codes:
// 0 = measured (including an empty project with no .paqad/ or docs/instructions),
// 2 = usage error.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  aggregateFootprint,
  buildFootprintReport,
  discoverFootprintFiles,
  renderFootprintMarkdown,
} from './lib/footprint.mjs';

/** Default tokenizer id — a general text tokenizer, not the RAG embedding model. */
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

/** char/4 — the same heuristic tokenizer-cache falls back to when the native load fails. */
function heuristicCounter() {
  return { countTokens: (text) => Math.ceil(text.length / 4), tokenizer_version: 'heuristic' };
}

/**
 * Load the real tokenizer from the built dist bundle (dedicated tsup entry), mirroring
 * the runtime/hooks/*.mjs dist-import pattern. Falls back to the char/4 heuristic when
 * the dist bundle is absent (repo not built) so the script always produces a number.
 */
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
    // ISO date only (no time) — stable across a run, no Date.now dependency on output identity.
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

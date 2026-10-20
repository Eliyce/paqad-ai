#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  bucketFindings,
  buildFindingsReport,
  renderFindingsMarkdown,
} from './lib/findings-stats.mjs';

const USAGE = 'Usage: node scripts/rule-findings-stats.mjs [--project <path>] [--json]';

const HOST_TIERS =
  'live-hook host (claude-code) + completion-hook hosts (codex-cli, gemini-cli) + manual/skill runs on any host';

function parseArgs(argv) {
  const args = { project: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--project') {
      args.project = argv[++i];
      if (args.project === undefined) {
        process.stderr.write(`Error: --project requires a value.\n${USAGE}\n`);
        process.exit(2);
      }
    } else {
      process.stderr.write(`Error: unknown argument "${arg}".\n${USAGE}\n`);
      process.exit(2);
    }
  }
  return args;
}

function readBundleFindingsRows(projectRoot) {
  const container = join(projectRoot, '.paqad', 'ledger', 'feature-evidence');
  let entries;
  try {
    entries = readdirSync(container, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue;
    }
    let text;
    try {
      text = readFileSync(join(container, entry.name, 'rule-run.jsonl'), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        rows.push(JSON.parse(trimmed));
      } catch {}
    }
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.project);
  const rows = readBundleFindingsRows(projectRoot);
  const bucketed = bucketFindings(rows);
  const meta = {
    project: projectRoot,
    hostTiers: HOST_TIERS,
    date: new Date().toISOString().slice(0, 10),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(buildFindingsReport(bucketed, meta), null, 2)}\n`);
  } else {
    process.stdout.write(`${renderFindingsMarkdown(bucketed, meta)}\n`);
  }
  process.exit(0);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

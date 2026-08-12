#!/usr/bin/env node
// Weekly deterministic-findings stats from the per-feature rule-run bundle files (issue
// #285, headline b; re-pointed for issue #468 Phase C, decision D-01KZV4A1). Read-only
// consumer of the EXISTING bundle evidence — reads the fresh-run findings rows from every
// `.paqad/ledger/feature-evidence/<feature>/rule-run.jsonl`, adds no new evidence store and
// never touches `.paqad/scripts/rules/.cache/report.json`.
//
//   node scripts/rule-findings-stats.mjs [--project <path>] [--json]
//
// --project defaults to the current directory. --json prints only the JSON report.
// Exit codes: 0 = read (including a project with no bundle rows, which prints "no data"),
// 2 = usage error.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  bucketFindings,
  buildFindingsReport,
  renderFindingsMarkdown,
} from './lib/findings-stats.mjs';

const USAGE = 'Usage: node scripts/rule-findings-stats.mjs [--project <path>] [--json]';

/**
 * Host tiers that feed the rule ledger, matching HOOK_COVERAGE_MATRIX: the runner fires
 * on live-hook and completion-hook hosts, plus manual/skill runs anywhere. Printed with
 * the number so no reader mistakes it for enforcement on advisory hosts.
 */
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

/**
 * Read every fresh-run findings row from the per-feature `rule-run.jsonl` bundle files
 * (issue #468 Phase C — the findings home since Phase B). Globs the feature-evidence
 * container, skipping the `_session` / `_chat` control dirs (which carry no rule-run
 * file), and tolerantly parses each JSONL line. No dist import is needed — the bundle is
 * plain JSONL on disk. A missing container / unreadable file is treated as no rows.
 */
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
      continue; // no rule-run.jsonl in this bundle
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        rows.push(JSON.parse(trimmed));
      } catch {
        // Tolerant: skip a partial/corrupt line (an append-only log survives a mid-crash write).
      }
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

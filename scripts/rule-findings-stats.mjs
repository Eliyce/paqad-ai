#!/usr/bin/env node
// Weekly deterministic-findings stats from the rule-evidence ledger (issue #285,
// headline b). Read-only consumer of the EXISTING ledger — reads via readProjectEvents,
// adds no new evidence store and never touches .paqad/scripts/rules/.cache/report.json.
//
//   node scripts/rule-findings-stats.mjs [--project <path>] [--json]
//
// --project defaults to the current directory. --json prints only the JSON report.
// Exit codes: 0 = read (including a project with no ledger rows, which prints "no data"),
// 2 = usage error.

import { resolve } from 'node:path';
import process from 'node:process';

import {
  RULE_EVIDENCE_DOC_TYPE,
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
 * Read the rule-evidence ledger via readProjectEvents from the built dist bundle
 * (dedicated tsup entry), mirroring the runtime/hooks/*.mjs dist-import pattern. When
 * the dist bundle is absent (repo not built) there is nothing to read, so treat it as
 * an empty ledger rather than erroring.
 */
async function readLedgerRows(projectRoot) {
  try {
    const distUrl = new URL('../dist/session-ledger/project-ledger.js', import.meta.url);
    const { readProjectEvents } = await import(distUrl.href);
    return readProjectEvents(projectRoot, RULE_EVIDENCE_DOC_TYPE);
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.project);
  const rows = await readLedgerRows(projectRoot);
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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});

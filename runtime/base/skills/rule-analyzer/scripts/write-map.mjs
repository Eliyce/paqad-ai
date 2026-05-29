#!/usr/bin/env node
// Purpose: Assemble docs/instructions/rules/rule-script-map.yml from the current
//          rule inventory + the analyzer's classifications, and write it through
//          the single-writer apply path (snapshot + atomic rename + events log).
// Usage:   node scripts/write-map.mjs <project-root> <classifications.json>
//          classifications.json: [{ "id": "RL-7f3a",
//                                    "verifiability": { "kind": "deterministic" },
//                                    "enforced_by": ["eslint:no-debugger"] }, ...]
// Output:  JSON { snapshot_path, applied_at, rule_count } on stdout.
import { readFileSync } from 'node:fs';

import {
  applyRuleScriptMap,
  assembleMap,
  loadRuleScriptMap,
  scanAndEmbedIds,
} from 'paqad-ai/rule-scripts';

const [, , projectRootArg, classificationsPath] = process.argv;
if (projectRootArg === '--help' || projectRootArg === '-h' || !classificationsPath) {
  process.stdout.write('Usage: node scripts/write-map.mjs <project-root> <classifications.json>\n');
  process.exit(projectRootArg && projectRootArg.startsWith('-') ? 0 : 1);
}

const projectRoot = projectRootArg;
const classificationsList = JSON.parse(readFileSync(classificationsPath, 'utf8'));
const classifications = new Map(
  classificationsList.map((c) => [
    c.id,
    { id: c.id, verifiability: c.verifiability, enforced_by: c.enforced_by ?? [] },
  ]),
);

// Re-scan (idempotent — markers already embedded) to get the authoritative
// inventory + hash, then assemble against the prior map for script carry-over.
const scan = scanAndEmbedIds(projectRoot);
const prior = loadRuleScriptMap(projectRoot);
const map = assembleMap(scan.inventory, classifications, scan.rule_files_hash, prior);

const result = applyRuleScriptMap({
  projectRoot,
  map,
  via: 'rule-analyzer',
  event: { action: 'analyze', rule_ids: map.rules.map((r) => r.id) },
});

process.stdout.write(`${JSON.stringify({ ...result, rule_count: map.rules.length }, null, 2)}\n`);

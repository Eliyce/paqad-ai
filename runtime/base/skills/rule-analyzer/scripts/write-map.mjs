#!/usr/bin/env node
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
let classificationsText;
try {
  classificationsText = readFileSync(classificationsPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  process.stderr.write(`classifications file not found: ${classificationsPath}\n`);
  process.exit(1);
}
const classificationsList = JSON.parse(classificationsText);
const classifications = new Map(
  classificationsList.map((c) => [
    c.id,
    { id: c.id, verifiability: c.verifiability, enforced_by: c.enforced_by ?? [] },
  ]),
);

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

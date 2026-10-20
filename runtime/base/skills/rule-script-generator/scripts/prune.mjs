#!/usr/bin/env node
import { loadRuleScriptMap, pruneOrphanScripts } from 'paqad-ai/rule-scripts';

const projectRoot = process.argv[2];
if (!projectRoot || projectRoot === '--help' || projectRoot === '-h') {
  process.stdout.write('Usage: node scripts/prune.mjs <project-root>\n');
  process.exit(projectRoot ? 0 : 1);
}

const map = loadRuleScriptMap(projectRoot);
const pruned = map ? pruneOrphanScripts(projectRoot, map) : [];
process.stdout.write(`${JSON.stringify({ pruned }, null, 2)}\n`);

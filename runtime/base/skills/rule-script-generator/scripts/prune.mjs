#!/usr/bin/env node
// Purpose: Delete orphaned rule-script .mjs files (and their __fixtures__) that
//          are no longer referenced by an active rule in rule-script-map.yml —
//          the prune step of a `generate rule scripts` cycle. Archived rules'
//          scripts survive one cycle then get pruned here.
// Usage:   node scripts/prune.mjs <project-root>
// Output:  JSON { pruned: string[] } on stdout.
import { loadRuleScriptMap, pruneOrphanScripts } from 'paqad-ai/rule-scripts';

const projectRoot = process.argv[2];
if (!projectRoot || projectRoot === '--help' || projectRoot === '-h') {
  process.stdout.write('Usage: node scripts/prune.mjs <project-root>\n');
  process.exit(projectRoot ? 0 : 1);
}

const map = loadRuleScriptMap(projectRoot);
const pruned = map ? pruneOrphanScripts(projectRoot, map) : [];
process.stdout.write(`${JSON.stringify({ pruned }, null, 2)}\n`);

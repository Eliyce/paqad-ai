#!/usr/bin/env node
// Purpose: Register a fixture-validated script onto its rule in
//          rule-script-map.yml, through the single-writer apply path. Re-runs
//          validation first and refuses to register a script that fails.
// Usage:   node scripts/register-script.mjs <project-root> <script-path-rel> \
//             <rule-id> <kind> <scope>
//          kind: deterministic | heuristic   scope: changed-files | whole-tree | ...
// Output:  JSON { registered, fixtures } on stdout.
// Exit:    0 if registered, 1 if rejected.
import { join } from 'node:path';

import {
  applyRuleScriptMap,
  loadRuleScriptMap,
  parseScriptHeader,
  runFixtures,
  upsertScriptEntry,
} from 'paqad-ai/rule-scripts';
import { readFileSync } from 'node:fs';

const [, , projectRoot, scriptRel, ruleId, kind, scope] = process.argv;
if (!projectRoot || !scriptRel || !ruleId || !kind || !scope) {
  process.stdout.write(
    'Usage: node scripts/register-script.mjs <project-root> <script-path-rel> <rule-id> <kind> <scope>\n',
  );
  process.exit(1);
}

const scriptAbs = join(projectRoot, scriptRel);
const header = parseScriptHeader(readFileSync(scriptAbs, 'utf8'));
const fixtures = runFixtures(scriptAbs);
const deferred = (fixtures.missing_binaries ?? []).length > 0;
if (deferred) {
  // Environment issue, not a logic failure — defer rather than reject.
  process.stdout.write(
    `${JSON.stringify({ registered: false, deferred: true, fixtures }, null, 2)}\n`,
  );
  process.exit(2);
}
if (!header.ok || !fixtures.passed) {
  process.stdout.write(
    `${JSON.stringify({ registered: false, header_errors: header.errors, fixtures }, null, 2)}\n`,
  );
  process.exit(1);
}

const map = loadRuleScriptMap(projectRoot);
if (!map) {
  process.stderr.write('rule-script-map.yml not found — run `analyze rules` first.\n');
  process.exit(1);
}

const now = new Date().toISOString();
const next = upsertScriptEntry(map, ruleId, {
  path: scriptRel,
  kind,
  runtime: 'node',
  scope,
  last_validated_at: now,
  fixtures_passed: true,
});

const result = applyRuleScriptMap({
  projectRoot,
  map: next,
  via: `rule-script-generator:${ruleId}`,
  event: { action: 'generate', rule_ids: [ruleId], note: scriptRel },
});

process.stdout.write(`${JSON.stringify({ registered: true, fixtures, ...result }, null, 2)}\n`);

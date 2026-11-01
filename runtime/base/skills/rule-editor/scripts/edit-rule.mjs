#!/usr/bin/env node
import {
  addRule,
  addRuleEntry,
  applyRuleScriptMap,
  archiveRule,
  cleanRuleText,
  collectRuleFiles,
  computeRuleFilesHash,
  editRuleText,
  loadRuleScriptMap,
  removeRuleBullet,
  ruleTextHash,
  setRuleText,
  setVerifiability,
} from 'paqad-ai/rule-scripts';

const [, , mode, projectRoot, a, b] = process.argv;

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

if (!mode || !projectRoot) {
  fail('Usage: node scripts/edit-rule.mjs <add|edit|remove|downgrade> <project-root> ...');
}

function applyMapMutation(mutate, ruleId, action, note) {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) {
    fail('rule-script-map.yml not found; run `analyze rules` first.');
  }
  const next = mutate(map);
  return applyRuleScriptMap({
    projectRoot,
    map: next,
    via: `rule-editor:${ruleId}`,
    event: { action, rule_ids: [ruleId], note },
  });
}

let out;
switch (mode) {
  case 'add': {
    if (!a || !b) fail('add requires <source-rel> <text>');
    const added = addRule(projectRoot, a, b);
    out = { mode, ...added };
    const map = loadRuleScriptMap(projectRoot);
    if (map) {
      const synced = addRuleEntry(map, added);
      synced.rule_files_hash = computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot));
      const result = applyRuleScriptMap({
        projectRoot,
        map: synced,
        via: `rule-editor:${added.id}`,
        event: { action: 'add', rule_ids: [added.id], note: added.source },
      });
      out = { ...out, ...result, map_synced: true };
    } else {
      out = { ...out, map_synced: false };
    }
    break;
  }
  case 'edit': {
    if (!a || !b) fail('edit requires <rule-id> <text>');
    const located = editRuleText(projectRoot, a, b);
    if (!located) fail(`rule ${a} not found on disk`);
    const clean = cleanRuleText(b);
    const result = applyMapMutation(
      (m) => setRuleText(m, a, clean, ruleTextHash(clean)),
      a,
      'edit',
      located.source,
    );
    out = { mode, rule_id: a, ...located, ...result };
    break;
  }
  case 'remove': {
    if (!a) fail('remove requires <rule-id>');
    const located = removeRuleBullet(projectRoot, a);
    if (!located) fail(`rule ${a} not found on disk`);
    const result = applyMapMutation((m) => archiveRule(m, a), a, 'remove', located.source);
    out = { mode, rule_id: a, ...located, ...result };
    break;
  }
  case 'downgrade': {
    if (!a || !b) fail('downgrade requires <rule-id> <reason>');
    const result = applyMapMutation(
      (m) => setVerifiability(m, a, { kind: 'unverifiable', reason: b }),
      a,
      'downgrade',
      b,
    );
    out = { mode, rule_id: a, ...result };
    break;
  }
  default:
    fail(`unknown mode: ${mode}`);
}

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

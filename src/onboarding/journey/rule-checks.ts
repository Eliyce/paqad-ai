import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

import { markChoicesReviewed } from './choices.js';
import type { ChoiceRow } from './types.js';

export const JOURNEY_VIA = 'paqad-onboarding';

export function ruleIds(projectRoot: string): string[] {
  return (loadRuleScriptMap(projectRoot)?.rules ?? []).map((rule) => rule.id);
}

function withFlags(
  map: RuleScriptMap,
  pick: (ruleId: string) => boolean,
  flag: boolean,
): { map: RuleScriptMap; changed: string[] } {
  const changed: string[] = [];
  const rules = map.rules.map((rule) => {
    if (!pick(rule.id) || rule.scripts.length === 0) return rule;
    const needs = rule.scripts.some((script) => (script.warn_until_reviewed === true) !== flag);
    if (!needs) return rule;
    changed.push(rule.id);
    return {
      ...rule,
      scripts: rule.scripts.map((script) => {
        if (flag) return { ...script, warn_until_reviewed: true };
        const cleared = { ...script };
        delete cleared.warn_until_reviewed;
        return cleared;
      }),
    };
  });
  return { map: { ...map, rules }, changed };
}

export function flagJourneyRuleChecks(
  projectRoot: string,
  rulesBefore: readonly string[],
): string[] {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return [];
  const before = new Set(rulesBefore);
  const next = withFlags(map, (id) => !before.has(id), true);
  if (next.changed.length === 0) return [];
  applyRuleScriptMap({
    projectRoot,
    map: next.map,
    via: JOURNEY_VIA,
    event: { action: 'edit', rule_ids: next.changed, note: 'warn until reviewed' },
  });
  return next.changed;
}

export function clearJourneyRuleCheckFlags(projectRoot: string): string[] {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return [];
  const next = withFlags(map, () => true, false);
  if (next.changed.length === 0) return [];
  applyRuleScriptMap({
    projectRoot,
    map: next.map,
    via: JOURNEY_VIA,
    event: { action: 'edit', rule_ids: next.changed, note: 'reviewed; checks now block' },
  });
  return next.changed;
}

export function reviewChoices(
  projectRoot: string,
  ids: readonly string[] | 'all',
  now: () => Date,
): ChoiceRow[] {
  const marked = markChoicesReviewed(projectRoot, ids, now);
  if (marked.some((row) => row.kind === 'rule_checks_warn_only'))
    clearJourneyRuleCheckFlags(projectRoot);
  return marked;
}

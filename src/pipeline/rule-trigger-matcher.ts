import { readCompiledRules } from '@/planning/rule-compiler.js';
import type { CompiledRule } from '@/core/types/planning.js';

export async function matchRuleTriggers(root: string, modulePaths: string[]): Promise<string[]> {
  const compiled = await readCompiledRules(root);
  if (!compiled || modulePaths.length === 0) {
    return [];
  }

  return compiled.rules
    .filter((rule) => ruleTriggersMatch(rule, modulePaths))
    .map((r) => r.rule_id);
}

/**
 * A rule "always loads" when it declares no scoped trigger: an explicit `**`
 * pattern, or no patterns at all. These apply to every change regardless of which
 * files are in play (RAG buildout F5).
 */
export function isAlwaysLoadRule(rule: Pick<CompiledRule, 'trigger_patterns'>): boolean {
  return rule.trigger_patterns.length === 0 || rule.trigger_patterns.includes('**');
}

/**
 * True when any of `paths` matches any of the rule's trigger patterns. Used to
 * decide whether a scoped rule's full text should be loaded for the files in
 * play. Always-load rules are handled separately by {@link isAlwaysLoadRule}.
 */
export function ruleTriggersMatch(
  rule: Pick<CompiledRule, 'trigger_patterns'>,
  paths: readonly string[],
): boolean {
  return rule.trigger_patterns.some((pattern) =>
    paths.some((path) => matchesGlobish(path, pattern)),
  );
}

export function matchesGlobish(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (normalizedPattern === '**') {
    return true;
  }

  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `^${escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')}$`,
  );
  return (
    regex.test(normalizedValue) || normalizedValue.includes(normalizedPattern.replace(/\*/g, ''))
  );
}

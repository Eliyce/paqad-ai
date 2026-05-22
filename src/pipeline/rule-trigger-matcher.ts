import { readCompiledRules } from '@/planning/rule-compiler.js';

export async function matchRuleTriggers(root: string, modulePaths: string[]): Promise<string[]> {
  const compiled = await readCompiledRules(root);
  if (!compiled || modulePaths.length === 0) {
    return [];
  }

  return compiled.rules
    .filter((rule) =>
      rule.trigger_patterns.some((pattern) =>
        modulePaths.some((modulePath) => matchesGlobish(modulePath, pattern)),
      ),
    )
    .map((rule) => rule.rule_id);
}

function matchesGlobish(value: string, pattern: string): boolean {
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

const FALLBACK_CLAUSE =
  '**Fallback:** if `.paqad/framework-path.txt` is missing or cannot be resolved, ' +
  'or paqad is disabled, proceed as a normal assistant with no paqad behavior. Do not block.';

export function buildFrameworkFallbackClause(): string {
  return FALLBACK_CLAUSE;
}

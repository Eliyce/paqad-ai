import { queryPatterns } from './store.js';
import type { PatternAdvisory, PatternQueryOptions, StackContext } from './types.js';

export async function buildPatternAdvisories(
  options: {
    stack_context?: StackContext;
    spec_keywords?: string[];
    storeRoot?: string;
  } & Pick<PatternQueryOptions, 'min_frequency' | 'max_age_days'>,
): Promise<PatternAdvisory[]> {
  const patterns = await queryPatterns(
    {
      stack_context: options.stack_context,
      min_frequency: options.min_frequency,
      max_age_days: options.max_age_days,
    },
    options.storeRoot,
  );

  return patterns.map((pattern) => ({
    advisory_id: `PA-${pattern.pattern_id}`,
    title: `Recurring pattern: ${pattern.subcategory}`,
    description:
      `Based on ${pattern.frequency} prior defect${pattern.frequency === 1 ? '' : 's'}, ` +
      `implementations in this area commonly miss: ${pattern.description}`,
  }));
}

export async function formatAgentContextWarnings(
  options: {
    stack_context?: StackContext;
    storeRoot?: string;
  } & Pick<PatternQueryOptions, 'min_frequency' | 'max_age_days'>,
): Promise<string> {
  const patterns = await queryPatterns(
    {
      stack_context: options.stack_context,
      min_frequency: options.min_frequency,
      max_age_days: options.max_age_days,
      limit: 5,
    },
    options.storeRoot,
  );

  if (patterns.length === 0) return '';

  const lines = [
    'Common defect patterns for this type of implementation:',
    ...patterns.map((p) => `- [${p.subcategory}, seen ${p.frequency}x] ${p.description}`),
    'Pay specific attention to these areas.',
  ];
  return lines.join('\n');
}

/**
 * FR-DP4: Feedback into Spec Quality Review
 * FR-DP5: Feedback into Agent Context
 *
 * Queries the pattern store for patterns relevant to the current spec or task
 * and formats them as advisories (review) or a warning block (agent context).
 */

import { queryPatterns } from './store.js';
import type { PatternAdvisory, PatternQueryOptions, StackContext } from './types.js';

/**
 * FR-DP4: Build pattern advisories for the spec quality review report.
 * Returns an empty array when no relevant patterns meet the thresholds —
 * producing no noise in the first-implementation scenario (EC-DP1).
 */
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

/**
 * FR-DP5: Format relevant patterns as a concise agent-context warning block.
 * Returns an empty string when no patterns qualify (EC-DP1 — no block, no error).
 * Caps at 5 patterns, each as a single sentence (FR-DP5.3).
 */
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

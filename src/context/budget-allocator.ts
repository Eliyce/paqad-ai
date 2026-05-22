import type { Chunk, SemanticLoadClassification } from './types.js';

export interface BudgetAllocation {
  critical_budget: number;
  task_relevant_budget: number;
  supporting_budget: number;
}

export interface BudgetClassificationHints {
  complexity?: SemanticLoadClassification['complexity'];
  scope?: SemanticLoadClassification['scope'];
}

// Ratio presets keyed by (complexity, scope) signal strength.
// trivial / single-file → minimal supporting context
// high-very-high / system-wide → larger supporting context for cross-cutting work
const RATIO_PRESETS: Array<{
  test: (hints: BudgetClassificationHints) => boolean;
  critical: number;
  task_relevant: number;
  supporting: number;
}> = [
  {
    // Trivial or single-file: very little supporting context needed
    test: ({ complexity, scope }) => complexity === 'trivial' || scope === 'single-file',
    critical: 0.55,
    task_relevant: 0.4,
    supporting: 0.05,
  },
  {
    // Low complexity or single-module: small supporting context
    test: ({ complexity, scope }) => complexity === 'low' || scope === 'single-module',
    critical: 0.5,
    task_relevant: 0.42,
    supporting: 0.08,
  },
  {
    // Very-high complexity or system-wide: large supporting context for cross-cutting work
    test: ({ complexity, scope }) => complexity === 'very-high' || scope === 'system-wide',
    critical: 0.35,
    task_relevant: 0.4,
    supporting: 0.25,
  },
  {
    // High complexity or multi-module: moderately larger supporting context
    test: ({ complexity, scope }) => complexity === 'high' || scope === 'multi-module',
    critical: 0.38,
    task_relevant: 0.42,
    supporting: 0.2,
  },
];

const DEFAULT_RATIOS = { critical: 0.4, task_relevant: 0.45, supporting: 0.15 };

export class BudgetAllocator {
  allocate(totalBudget: number, hints?: BudgetClassificationHints): BudgetAllocation {
    const ratios =
      hints !== undefined
        ? (RATIO_PRESETS.find((preset) => preset.test(hints)) ?? DEFAULT_RATIOS)
        : DEFAULT_RATIOS;

    return {
      critical_budget: Math.floor(totalBudget * ratios.critical),
      task_relevant_budget: Math.floor(totalBudget * ratios.task_relevant),
      supporting_budget: Math.floor(totalBudget * ratios.supporting),
    };
  }

  packChunks(
    chunks: Chunk[],
    budgetTokens: number,
    estimateTokens: (text: string) => number = (t) => Math.ceil(t.length / 4),
  ): Chunk[] {
    const packed: Chunk[] = [];
    const seen = new Set<string>();
    let remaining = budgetTokens;

    for (const chunk of chunks) {
      const signature = chunk.content_hash || normalizeChunkContent(chunk.content);
      if (seen.has(signature)) {
        continue;
      }

      const tokens = estimateTokens(chunk.content);
      if (tokens <= remaining) {
        packed.push(chunk);
        seen.add(signature);
        remaining -= tokens;
      }
      if (remaining <= 0) break;
    }

    return packed;
  }
}

function normalizeChunkContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

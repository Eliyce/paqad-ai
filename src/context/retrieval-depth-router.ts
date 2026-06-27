import type { ClassificationWorkflow, ClassificationScope } from '@/core/types/classification.js';
import type { Complexity, Risk } from '@/core/types/routing.js';
import type { RetrievalDepth } from './types.js';

export interface DepthRoutingInput {
  complexity?: Complexity;
  risk?: Risk;
  scope?: ClassificationScope;
  workflow?: ClassificationWorkflow | null;
}

/**
 * Selects retrieval depth using deterministic rules derived from classification
 * signals. No model is required.
 *
 * none     — skip vector retrieval entirely (lexical/structural scoring only)
 * standard — current hybrid retrieval with existing rag_top_n
 * deep     — expanded candidate set (rag_top_n * 3)
 */
export function selectRetrievalDepth(input: DepthRoutingInput): RetrievalDepth {
  const { complexity, risk, scope, workflow } = input;

  // none: investigation workflow on trivial/low complexity tasks
  if (workflow === 'investigation' && (complexity === 'trivial' || complexity === 'low')) {
    return 'none';
  }

  // none: trivial single-file renames and cleanups
  if (complexity === 'trivial' && scope === 'single-file') {
    return 'none';
  }

  // deep: high/very-high complexity, system-wide scope, or high risk
  if (
    complexity === 'high' ||
    complexity === 'very-high' ||
    scope === 'system-wide' ||
    risk === 'high'
  ) {
    return 'deep';
  }

  return 'standard';
}

/**
 * Escalates depth by one level. Bounded at 'deep' — calling with 'deep' is a
 * no-op and returns 'deep'.
 */
export function escalateDepth(depth: RetrievalDepth): RetrievalDepth {
  if (depth === 'none') return 'standard';
  if (depth === 'standard') return 'deep';
  return 'deep';
}

/**
 * Returns the rag_top_n multiplier for a given retrieval depth.
 * none → 0 (skip vector retrieval)
 * standard → 1 (use configured rag_top_n as-is)
 * deep → 3 (expand candidate pool)
 */
export function topNForDepth(depth: RetrievalDepth, baseTopN: number): number {
  if (depth === 'none') return 0;
  if (depth === 'deep') return baseTopN * 3;
  return baseTopN;
}

export interface RetrievalGate {
  /** The selected depth. */
  depth: RetrievalDepth;
  /** The effective top-k for retrieval (0 when skipping). */
  topN: number;
  /** True when the stage needs no retrieval at all (depth 'none'); callers skip the query. */
  skip: boolean;
}

/**
 * Stage-aware retrieval gate (RAG buildout F14). Combines {@link selectRetrievalDepth}
 * and {@link topNForDepth} into the decision a retrieval consumer needs: how many
 * candidates to pull, and whether to skip retrieval entirely. A stage that is
 * self-contained (e.g. a trivial single-file cleanup, or a trivial investigation)
 * resolves to `skip: true` so no embedding/query work happens at all — retrieval is
 * only paid for when the stage can actually use it.
 */
export function gateRetrieval(input: DepthRoutingInput & { baseTopN: number }): RetrievalGate {
  const depth = selectRetrievalDepth(input);
  const topN = topNForDepth(depth, input.baseTopN);
  return { depth, topN, skip: topN === 0 };
}

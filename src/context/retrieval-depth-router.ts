import type { ClassificationWorkflow, ClassificationScope } from '@/core/types/classification.js';
import type { Complexity, Risk } from '@/core/types/routing.js';
import type { RetrievalDepth } from './types.js';

export interface DepthRoutingInput {
  complexity?: Complexity;
  risk?: Risk;
  scope?: ClassificationScope;
  workflow?: ClassificationWorkflow | null;
}

export function selectRetrievalDepth(input: DepthRoutingInput): RetrievalDepth {
  const { complexity, risk, scope, workflow } = input;

  if (workflow === 'investigation' && (complexity === 'trivial' || complexity === 'low')) {
    return 'none';
  }

  if (complexity === 'trivial' && scope === 'single-file') {
    return 'none';
  }

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

export function escalateDepth(depth: RetrievalDepth): RetrievalDepth {
  if (depth === 'none') return 'standard';
  if (depth === 'standard') return 'deep';
  return 'deep';
}

export function topNForDepth(depth: RetrievalDepth, baseTopN: number): number {
  if (depth === 'none') return 0;
  if (depth === 'deep') return baseTopN * 3;
  return baseTopN;
}

export interface RetrievalGate {
  depth: RetrievalDepth;
  topN: number;
  skip: boolean;
}

export function gateRetrieval(input: DepthRoutingInput & { baseTopN: number }): RetrievalGate {
  const depth = selectRetrievalDepth(input);
  const topN = topNForDepth(depth, input.baseTopN);
  return { depth, topN, skip: topN === 0 };
}

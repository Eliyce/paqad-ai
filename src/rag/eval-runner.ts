import type {
  ComparisonMode,
  EvalDatasetItem,
  EvalRunResult,
  EvalTrace,
  ModelGradedScores,
} from './types.js';

/**
 * Compute hit@K from real eval traces.
 *
 * An item is a "hit" if `expected_file` appears as a path suffix of one of
 * the top-K `first_stage_chunk_ids`. Items without `expected_file` or with
 * `should_skip_retrieval` are excluded from the denominator.
 *
 * Exposed as a standalone export so the CLI can use it without instantiating
 * an EvalRunner.
 */
export function computeHitAtK(dataset: EvalDatasetItem[], traces: EvalTrace[], k: number): number {
  const eligible = dataset.filter((item) => item.expected_file && !item.should_skip_retrieval);
  if (eligible.length === 0) return 0;

  const hits = eligible.filter((item) => {
    const trace = traces.find((t) => t.item_id === item.id);
    if (!trace) return false;
    const topK = trace.first_stage_chunk_ids.slice(0, k);
    const expected = item.expected_file!.replace(/\\/g, '/');
    return topK.some((id) => id.replace(/\\/g, '/').endsWith(expected));
  });

  return hits.length / eligible.length;
}

export function computeTaskSuccessRate(dataset: EvalDatasetItem[], traces: EvalTrace[]): number {
  if (dataset.length === 0) return 0;

  let successes = 0;
  for (const item of dataset) {
    const trace = traces.find((candidate) => candidate.item_id === item.id);
    if (!trace) {
      continue;
    }

    if (item.should_skip_retrieval) {
      if (
        (trace.retrieval_depth ?? 'standard') === 'none' &&
        trace.first_stage_chunk_ids.length === 0
      ) {
        successes += 1;
      }
      continue;
    }

    if (item.workflow_trigger) {
      if (trace.routed_workflow_id === item.workflow_trigger) {
        successes += 1;
      }
      continue;
    }

    if (item.expected_file) {
      const expected = item.expected_file.replace(/\\/g, '/');
      if (trace.packed_chunk_ids.some((id) => id.replace(/\\/g, '/').endsWith(expected))) {
        successes += 1;
      }
      continue;
    }

    if (trace.packed_chunk_ids.length > 0) {
      successes += 1;
    }
  }

  return successes / dataset.length;
}

export function computeCorrectionTurns(dataset: EvalDatasetItem[], traces: EvalTrace[]): number {
  if (dataset.length === 0) return 0;
  return 1 - computeTaskSuccessRate(dataset, traces);
}

export function computePromptTokensSent(traces: EvalTrace[]): number {
  return traces.reduce((sum, trace) => sum + (trace.packed_token_count ?? 0), 0);
}

export interface ModelGrader {
  gradeRetrievalRelevance(query: string, chunkIds: string[]): Promise<number>;
  gradeAnswerFaithfulness(query: string, answer: string, chunkIds: string[]): Promise<number>;
  gradeActionUsefulness(query: string, recommendation: string): Promise<number>;
  gradeRoutingCorrectness(
    query: string,
    routedWorkflow: string | undefined,
    expectedWorkflow: string | undefined,
  ): Promise<number>;
}

/**
 * EvalRunner produces deterministic EvalRunResult objects from a dataset and
 * optional pre-computed traces. The model-graded path is always async,
 * separately invokable, and must never be called from pnpm test.
 */
export class EvalRunner {
  constructor(private readonly grader?: ModelGrader) {}

  run(dataset: EvalDatasetItem[], mode: ComparisonMode, traces?: EvalTrace[]): EvalRunResult {
    const resolvedTraces: EvalTrace[] =
      traces ??
      dataset.map((item) => ({
        item_id: item.id,
        first_stage_chunk_ids: [],
        packed_chunk_ids: [],
      }));

    return {
      mode,
      timestamp: new Date().toISOString(),
      dataset_size: dataset.length,
      traces: resolvedTraces,
    };
  }

  async runModelGraded(
    dataset: EvalDatasetItem[],
    traces: EvalTrace[],
  ): Promise<ModelGradedScores> {
    if (!this.grader || dataset.length === 0) {
      return {
        retrieval_relevance: 0,
        answer_faithfulness: 0,
        action_recommendation_usefulness: 0,
        routing_correctness: 0,
      };
    }

    let totalRelevance = 0;
    let totalFaithfulness = 0;
    let totalActionUsefulness = 0;
    let totalRoutingCorrectness = 0;

    for (const item of dataset) {
      const trace = traces.find((t) => t.item_id === item.id);
      const chunkIds = trace?.packed_chunk_ids ?? [];
      const answer = trace?.final_answer_or_recommendation ?? '';
      const routedWorkflow = trace?.routed_workflow_id;

      totalRelevance += await this.grader.gradeRetrievalRelevance(item.task_description, chunkIds);
      totalFaithfulness += await this.grader.gradeAnswerFaithfulness(
        item.task_description,
        answer,
        chunkIds,
      );
      totalActionUsefulness += await this.grader.gradeActionUsefulness(
        item.task_description,
        answer,
      );
      totalRoutingCorrectness += await this.grader.gradeRoutingCorrectness(
        item.task_description,
        routedWorkflow,
        item.workflow_trigger,
      );
    }

    const count = dataset.length;
    return {
      retrieval_relevance: totalRelevance / count,
      answer_faithfulness: totalFaithfulness / count,
      action_recommendation_usefulness: totalActionUsefulness / count,
      routing_correctness: totalRoutingCorrectness / count,
    };
  }
}

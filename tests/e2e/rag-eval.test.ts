import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareConfigurations } from '@/rag/benchmark-gates.js';
import { EVAL_DATASET, getDatasetByClass, validateDatasetCoverage } from '@/rag/eval-dataset.js';
import { EvalRunner } from '@/rag/eval-runner.js';
import type { ComparisonMode, RagBenchmarkSnapshot } from '@/rag/types.js';

const EVAL_TRACES_PATH = join(process.cwd(), 'coverage', 'rag-eval-traces.json');

const BASELINE: RagBenchmarkSnapshot = {
  hit_at_5: 0.5,
  task_success_rate: 0.4,
  correction_turns: 2.0,
  prompt_tokens_sent: 8000,
  task_count: 32,
};

const CANDIDATE: RagBenchmarkSnapshot = {
  hit_at_5: 0.68,
  task_success_rate: 0.46,
  correction_turns: 1.5,
  prompt_tokens_sent: 8600,
  task_count: 32,
};

describe('RAG evaluation extension — end-to-end', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `paqad-eval-e2e-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dataset covers all 6 required query classes', () => {
    expect(validateDatasetCoverage()).toBe(true);
    expect(getDatasetByClass('simple-lexical').length).toBeGreaterThan(0);
    expect(getDatasetByClass('vocabulary-mismatch').length).toBeGreaterThan(0);
    expect(getDatasetByClass('ambiguous').length).toBeGreaterThan(0);
    expect(getDatasetByClass('multi-part').length).toBeGreaterThan(0);
    expect(getDatasetByClass('workflow-triggering').length).toBeGreaterThan(0);
    expect(getDatasetByClass('negative').length).toBeGreaterThan(0);
  });

  it.each(['lexical-vs-rag', 'rag-vs-candidate', 'feature-off-vs-on'] as ComparisonMode[])(
    'compareConfigurations works end-to-end for mode "%s"',
    (mode) => {
      const result = compareConfigurations(BASELINE, CANDIDATE, mode);
      expect(result.mode).toBe(mode);
      expect(typeof result.evaluation.passed).toBe('boolean');
      expect(result.evaluation.baseline).toEqual(BASELINE);
      expect(result.evaluation.candidate).toEqual(CANDIDATE);
    },
  );

  it('EvalRunner produces deterministic run results that can be written as trace artifacts', () => {
    const runner = new EvalRunner();
    const result = runner.run(EVAL_DATASET, 'lexical-vs-rag');

    expect(result.dataset_size).toBe(EVAL_DATASET.length);
    expect(result.traces).toHaveLength(EVAL_DATASET.length);

    // Write trace artifact (mirrors what pnpm test would do during a real benchmark run)
    mkdirSync(join(process.cwd(), 'coverage'), { recursive: true });
    writeFileSync(EVAL_TRACES_PATH, JSON.stringify(result.traces, null, 2), 'utf8');
    expect(existsSync(EVAL_TRACES_PATH)).toBe(true);
  });

  it('model-graded eval resolves without blocking and does not throw', async () => {
    // No grader injected — must resolve silently with zero scores
    const runner = new EvalRunner();
    const traces = EVAL_DATASET.map((item) => ({
      item_id: item.id,
      first_stage_chunk_ids: [],
      packed_chunk_ids: [],
    }));

    await expect(runner.runModelGraded(EVAL_DATASET, traces)).resolves.toMatchObject({
      retrieval_relevance: 0,
      answer_faithfulness: 0,
      action_recommendation_usefulness: 0,
      routing_correctness: 0,
    });
  });

  it('model-graded eval with injected grader aggregates scores correctly', async () => {
    const grader = {
      gradeRetrievalRelevance: vi.fn().mockResolvedValue(0.9),
      gradeAnswerFaithfulness: vi.fn().mockResolvedValue(0.85),
      gradeActionUsefulness: vi.fn().mockResolvedValue(0.75),
      gradeRoutingCorrectness: vi.fn().mockResolvedValue(1.0),
    };
    const runner = new EvalRunner(grader);
    const dataset = EVAL_DATASET.slice(0, 2);
    const traces = dataset.map((item) => ({
      item_id: item.id,
      first_stage_chunk_ids: ['c1'],
      packed_chunk_ids: ['c1'],
      routed_workflow_id: item.workflow_trigger,
      final_answer_or_recommendation: 'suggestion',
    }));

    const scores = await runner.runModelGraded(dataset, traces);
    expect(scores.retrieval_relevance).toBeCloseTo(0.9);
    expect(scores.answer_faithfulness).toBeCloseTo(0.85);
    expect(scores.action_recommendation_usefulness).toBeCloseTo(0.75);
    expect(scores.routing_correctness).toBeCloseTo(1.0);
  });
});

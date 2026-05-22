import {
  EvalRunner,
  computeCorrectionTurns,
  computeHitAtK,
  computePromptTokensSent,
  computeTaskSuccessRate,
} from '@/rag/eval-runner.js';
import type { ModelGrader } from '@/rag/eval-runner.js';
import type { ComparisonMode, EvalDatasetItem, EvalTrace } from '@/rag/types.js';

const SAMPLE_DATASET: EvalDatasetItem[] = [
  {
    id: 'test-1',
    query_class: 'simple-lexical',
    task_description: 'authorization check failing',
    keywords: ['authorization'],
    expected_file: 'src/security/auth-gates.ts',
  },
  {
    id: 'test-2',
    query_class: 'workflow-triggering',
    task_description: 'run a security audit',
    keywords: ['security', 'audit'],
    workflow_trigger: 'pentest',
  },
];

const SAMPLE_TRACES: EvalTrace[] = [
  {
    item_id: 'test-1',
    retrieval_depth: 'standard',
    first_stage_chunk_ids: ['/abs/project/src/security/auth-gates.ts', '/abs/project/src/other.ts'],
    packed_chunk_ids: ['/abs/project/src/security/auth-gates.ts'],
    packed_token_count: 12,
    final_answer_or_recommendation: 'Check auth-gates.ts',
  },
  {
    item_id: 'test-2',
    retrieval_depth: 'deep',
    first_stage_chunk_ids: ['/abs/project/docs/instructions/workflows/pentest.yaml'],
    packed_chunk_ids: ['/abs/project/docs/instructions/workflows/pentest.yaml'],
    packed_token_count: 8,
    routed_workflow_id: 'pentest',
    final_answer_or_recommendation: 'pentest',
  },
];

describe('EvalRunner', () => {
  describe('run()', () => {
    it.each(['lexical-vs-rag', 'rag-vs-candidate', 'feature-off-vs-on'] as ComparisonMode[])(
      'returns correct mode for "%s"',
      (mode) => {
        const runner = new EvalRunner();
        const result = runner.run(SAMPLE_DATASET, mode);
        expect(result.mode).toBe(mode);
      },
    );

    it('returns correct dataset_size', () => {
      const runner = new EvalRunner();
      const result = runner.run(SAMPLE_DATASET, 'lexical-vs-rag');
      expect(result.dataset_size).toBe(SAMPLE_DATASET.length);
    });

    it('generates default traces when none provided', () => {
      const runner = new EvalRunner();
      const result = runner.run(SAMPLE_DATASET, 'lexical-vs-rag');
      expect(result.traces).toHaveLength(SAMPLE_DATASET.length);
      for (const [i, trace] of result.traces.entries()) {
        expect(trace.item_id).toBe(SAMPLE_DATASET[i].id);
        expect(trace.first_stage_chunk_ids).toEqual([]);
        expect(trace.packed_chunk_ids).toEqual([]);
      }
    });

    it('uses provided traces when supplied', () => {
      const runner = new EvalRunner();
      const result = runner.run(SAMPLE_DATASET, 'rag-vs-candidate', SAMPLE_TRACES);
      expect(result.traces).toBe(SAMPLE_TRACES);
    });

    it('includes a valid ISO timestamp', () => {
      const runner = new EvalRunner();
      const result = runner.run(SAMPLE_DATASET, 'feature-off-vs-on');
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('does not include model_graded in deterministic result', () => {
      const runner = new EvalRunner();
      const result = runner.run(SAMPLE_DATASET, 'lexical-vs-rag');
      expect(result.model_graded).toBeUndefined();
    });
  });

  describe('runModelGraded()', () => {
    it('returns all-zero scores when no grader is provided', async () => {
      const runner = new EvalRunner();
      const scores = await runner.runModelGraded(SAMPLE_DATASET, SAMPLE_TRACES);
      expect(scores.retrieval_relevance).toBe(0);
      expect(scores.answer_faithfulness).toBe(0);
      expect(scores.action_recommendation_usefulness).toBe(0);
      expect(scores.routing_correctness).toBe(0);
    });

    it('returns all-zero scores for empty dataset', async () => {
      const grader: ModelGrader = {
        gradeRetrievalRelevance: vi.fn().mockResolvedValue(1),
        gradeAnswerFaithfulness: vi.fn().mockResolvedValue(1),
        gradeActionUsefulness: vi.fn().mockResolvedValue(1),
        gradeRoutingCorrectness: vi.fn().mockResolvedValue(1),
      };
      const runner = new EvalRunner(grader);
      const scores = await runner.runModelGraded([], []);
      expect(scores.retrieval_relevance).toBe(0);
      expect(scores.answer_faithfulness).toBe(0);
      expect(scores.action_recommendation_usefulness).toBe(0);
      expect(scores.routing_correctness).toBe(0);
    });

    it('averages scores across dataset items when grader provided', async () => {
      const grader: ModelGrader = {
        gradeRetrievalRelevance: vi.fn().mockResolvedValue(0.8),
        gradeAnswerFaithfulness: vi.fn().mockResolvedValue(0.6),
        gradeActionUsefulness: vi.fn().mockResolvedValue(0.7),
        gradeRoutingCorrectness: vi.fn().mockResolvedValue(0.9),
      };
      const runner = new EvalRunner(grader);
      const scores = await runner.runModelGraded(SAMPLE_DATASET, SAMPLE_TRACES);

      expect(scores.retrieval_relevance).toBeCloseTo(0.8);
      expect(scores.answer_faithfulness).toBeCloseTo(0.6);
      expect(scores.action_recommendation_usefulness).toBeCloseTo(0.7);
      expect(scores.routing_correctness).toBeCloseTo(0.9);
    });

    it('calls grader with correct query and chunk IDs from matching trace', async () => {
      const grader: ModelGrader = {
        gradeRetrievalRelevance: vi.fn().mockResolvedValue(1),
        gradeAnswerFaithfulness: vi.fn().mockResolvedValue(1),
        gradeActionUsefulness: vi.fn().mockResolvedValue(1),
        gradeRoutingCorrectness: vi.fn().mockResolvedValue(1),
      };
      const runner = new EvalRunner(grader);
      await runner.runModelGraded([SAMPLE_DATASET[0]], SAMPLE_TRACES);

      expect(grader.gradeRetrievalRelevance).toHaveBeenCalledWith(
        SAMPLE_DATASET[0].task_description,
        SAMPLE_TRACES[0].packed_chunk_ids,
      );
    });

    it('grades routing correctness from routed_workflow_id, not freeform answer text', async () => {
      const grader: ModelGrader = {
        gradeRetrievalRelevance: vi.fn().mockResolvedValue(1),
        gradeAnswerFaithfulness: vi.fn().mockResolvedValue(1),
        gradeActionUsefulness: vi.fn().mockResolvedValue(1),
        gradeRoutingCorrectness: vi.fn().mockResolvedValue(1),
      };
      const runner = new EvalRunner(grader);
      await runner.runModelGraded([SAMPLE_DATASET[1]], SAMPLE_TRACES);

      expect(grader.gradeRoutingCorrectness).toHaveBeenCalledWith(
        SAMPLE_DATASET[1].task_description,
        'pentest',
        'pentest',
      );
    });

    it('uses empty defaults when no matching trace found for an item', async () => {
      const grader: ModelGrader = {
        gradeRetrievalRelevance: vi.fn().mockResolvedValue(0.5),
        gradeAnswerFaithfulness: vi.fn().mockResolvedValue(0.5),
        gradeActionUsefulness: vi.fn().mockResolvedValue(0.5),
        gradeRoutingCorrectness: vi.fn().mockResolvedValue(0.5),
      };
      const runner = new EvalRunner(grader);
      const singleItem: EvalDatasetItem[] = [
        { id: 'no-match', query_class: 'ambiguous', task_description: 'test', keywords: [] },
      ];
      await expect(runner.runModelGraded(singleItem, [])).resolves.toBeDefined();
      expect(grader.gradeRetrievalRelevance).toHaveBeenCalledWith('test', []);
    });
  });
});

describe('computeHitAtK', () => {
  const dataset: EvalDatasetItem[] = [
    {
      id: 'hit-1',
      query_class: 'simple-lexical',
      task_description: 'auth check',
      keywords: ['auth'],
      expected_file: 'src/security/auth-gates.ts',
    },
    {
      id: 'hit-2',
      query_class: 'simple-lexical',
      task_description: 'billing',
      keywords: ['billing'],
      expected_file: 'src/billing/invoice.ts',
    },
    {
      id: 'no-expected',
      query_class: 'ambiguous',
      task_description: 'ambiguous',
      keywords: ['ambiguous'],
      // no expected_file — excluded from denominator
    },
    {
      id: 'skip-1',
      query_class: 'negative',
      task_description: 'rename variable',
      keywords: ['rename'],
      expected_file: 'src/utils.ts',
      should_skip_retrieval: true, // excluded from denominator
    },
  ];

  it('returns 1.0 when all eligible items are hits', () => {
    const traces: EvalTrace[] = [
      {
        item_id: 'hit-1',
        first_stage_chunk_ids: ['/abs/root/src/security/auth-gates.ts', '/abs/root/src/other.ts'],
        packed_chunk_ids: [],
      },
      {
        item_id: 'hit-2',
        first_stage_chunk_ids: ['/abs/root/src/billing/invoice.ts'],
        packed_chunk_ids: [],
      },
    ];
    expect(computeHitAtK(dataset, traces, 5)).toBe(1.0);
  });

  it('returns 0.5 when half of eligible items are hits', () => {
    const traces: EvalTrace[] = [
      {
        item_id: 'hit-1',
        first_stage_chunk_ids: ['/abs/root/src/security/auth-gates.ts'],
        packed_chunk_ids: [],
      },
      {
        item_id: 'hit-2',
        first_stage_chunk_ids: ['/abs/root/src/unrelated.ts'],
        packed_chunk_ids: [],
      },
    ];
    expect(computeHitAtK(dataset, traces, 5)).toBe(0.5);
  });

  it('returns 0 when no eligible items are hits', () => {
    const traces: EvalTrace[] = [
      {
        item_id: 'hit-1',
        first_stage_chunk_ids: ['/abs/root/src/unrelated.ts'],
        packed_chunk_ids: [],
      },
      {
        item_id: 'hit-2',
        first_stage_chunk_ids: ['/abs/root/src/another.ts'],
        packed_chunk_ids: [],
      },
    ];
    expect(computeHitAtK(dataset, traces, 5)).toBe(0);
  });

  it('respects K — only looks at the top-K chunk IDs', () => {
    const traces: EvalTrace[] = [
      {
        item_id: 'hit-1',
        // expected_file is at position 3 (index 2), outside k=2
        first_stage_chunk_ids: [
          '/abs/root/src/a.ts',
          '/abs/root/src/b.ts',
          '/abs/root/src/security/auth-gates.ts',
        ],
        packed_chunk_ids: [],
      },
      {
        item_id: 'hit-2',
        first_stage_chunk_ids: ['/abs/root/src/billing/invoice.ts'],
        packed_chunk_ids: [],
      },
    ];
    expect(computeHitAtK(dataset, traces, 2)).toBe(0.5); // hit-1 misses, hit-2 hits
    expect(computeHitAtK(dataset, traces, 3)).toBe(1.0); // both hit
  });

  it('returns 0 when no eligible items exist', () => {
    const onlySkipped: EvalDatasetItem[] = [
      {
        id: 'skip',
        query_class: 'negative',
        task_description: 'x',
        keywords: [],
        should_skip_retrieval: true,
      },
    ];
    expect(computeHitAtK(onlySkipped, [], 5)).toBe(0);
  });

  it('excludes items without expected_file from both numerator and denominator', () => {
    // Only 'hit-1' is eligible (hit-2 has no trace, no-expected excluded, skip excluded)
    const traces: EvalTrace[] = [
      {
        item_id: 'hit-1',
        first_stage_chunk_ids: ['/abs/root/src/security/auth-gates.ts'],
        packed_chunk_ids: [],
      },
    ];
    // hit-1 hits, hit-2 has no trace (miss) → 1/2 = 0.5
    expect(computeHitAtK(dataset, traces, 5)).toBe(0.5);
  });
});

describe('deterministic eval metrics', () => {
  it('computes task success rate across retrieval, workflow, and skip cases', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'retrieval-ok',
        query_class: 'simple-lexical',
        task_description: 'auth',
        keywords: ['auth'],
        expected_file: 'src/security/auth-gates.ts',
      },
      {
        id: 'workflow-ok',
        query_class: 'workflow-triggering',
        task_description: 'pentest',
        keywords: ['pentest'],
        workflow_trigger: 'pentest',
      },
      {
        id: 'skip-ok',
        query_class: 'negative',
        task_description: 'rename',
        keywords: ['rename'],
        should_skip_retrieval: true,
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'retrieval-ok',
        retrieval_depth: 'standard',
        first_stage_chunk_ids: ['/abs/project/src/security/auth-gates.ts'],
        packed_chunk_ids: ['/abs/project/src/security/auth-gates.ts'],
      },
      {
        item_id: 'workflow-ok',
        retrieval_depth: 'standard',
        first_stage_chunk_ids: ['/abs/project/docs/instructions/workflows/pentest.yaml'],
        packed_chunk_ids: ['/abs/project/docs/instructions/workflows/pentest.yaml'],
        routed_workflow_id: 'pentest',
      },
      {
        item_id: 'skip-ok',
        retrieval_depth: 'none',
        first_stage_chunk_ids: [],
        packed_chunk_ids: [],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(1);
    expect(computeCorrectionTurns(dataset, traces)).toBe(0);
  });

  it('sums prompt tokens from packed_token_count', () => {
    expect(computePromptTokensSent(SAMPLE_TRACES)).toBe(20);
  });

  it('treats missing packed_token_count as zero', () => {
    expect(
      computePromptTokensSent([
        { item_id: 'no-count', first_stage_chunk_ids: [], packed_chunk_ids: [] },
      ]),
    ).toBe(0);
  });

  it('returns 0 task success and 0 correction turns for an empty dataset', () => {
    expect(computeTaskSuccessRate([], [])).toBe(0);
    expect(computeCorrectionTurns([], [])).toBe(0);
  });

  it('treats missing traces as unsuccessful instead of crashing', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'missing-trace',
        query_class: 'ambiguous',
        task_description: 'ambiguous request',
        keywords: ['ambiguous'],
      },
    ];

    expect(computeTaskSuccessRate(dataset, [])).toBe(0);
  });

  it('counts skip items as successful only when retrieval is truly skipped', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'skip',
        query_class: 'negative',
        task_description: 'rename variable',
        keywords: ['rename'],
        should_skip_retrieval: true,
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'skip',
        retrieval_depth: 'none',
        first_stage_chunk_ids: [],
        packed_chunk_ids: [],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(1);
  });

  it('does not count skip items as successful when retrieval still returned chunks', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'skip',
        query_class: 'negative',
        task_description: 'rename variable',
        keywords: ['rename'],
        should_skip_retrieval: true,
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'skip',
        retrieval_depth: 'standard',
        first_stage_chunk_ids: ['/abs/root/src/file.ts'],
        packed_chunk_ids: [],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(0);
  });

  it('does not count skip items as successful when retrieval depth is none but chunk ids still exist', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'skip',
        query_class: 'negative',
        task_description: 'rename variable',
        keywords: ['rename'],
        should_skip_retrieval: true,
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'skip',
        retrieval_depth: 'none',
        first_stage_chunk_ids: ['/abs/root/src/file.ts'],
        packed_chunk_ids: [],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(0);
  });

  it('defaults missing retrieval depth to standard for skip items', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'skip',
        query_class: 'negative',
        task_description: 'rename variable',
        keywords: ['rename'],
        should_skip_retrieval: true,
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'skip',
        first_stage_chunk_ids: [],
        packed_chunk_ids: [],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(0);
  });

  it('counts generic tasks as successful when any packed chunk is returned', () => {
    const dataset: EvalDatasetItem[] = [
      {
        id: 'generic',
        query_class: 'ambiguous',
        task_description: 'find something useful',
        keywords: ['useful'],
      },
    ];
    const traces: EvalTrace[] = [
      {
        item_id: 'generic',
        retrieval_depth: 'standard',
        first_stage_chunk_ids: ['/abs/root/src/useful.ts'],
        packed_chunk_ids: ['/abs/root/src/useful.ts'],
      },
    ];

    expect(computeTaskSuccessRate(dataset, traces)).toBe(1);
  });
});

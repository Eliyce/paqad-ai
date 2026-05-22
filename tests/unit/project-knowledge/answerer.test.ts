import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceFile } from '@/project-knowledge/evidence-retriever.js';
import type {
  FreshnessMetadata,
  Contradiction,
  KnowledgeAnswer,
} from '@/project-knowledge/types.js';

const { mockRetrieve, mockCheck, mockDetect, mockReadProjectProfile } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  mockCheck: vi.fn(),
  mockDetect: vi.fn(),
  mockReadProjectProfile: vi.fn(),
}));

vi.mock('@/project-knowledge/evidence-retriever.js', () => ({
  EvidenceRetriever: vi.fn().mockImplementation(() => ({ retrieve: mockRetrieve })),
  extractKeywords: vi.fn(),
  scoreFile: vi.fn(),
}));

vi.mock('@/project-knowledge/freshness-checker.js', () => ({
  FreshnessChecker: vi.fn().mockImplementation(() => ({ check: mockCheck })),
}));

vi.mock('@/project-knowledge/contradiction-detector.js', () => ({
  ContradictionDetector: vi.fn().mockImplementation(() => ({ detect: mockDetect })),
}));

vi.mock('@/core/project-profile.js', () => ({
  readProjectProfile: mockReadProjectProfile,
}));

import { ProjectKnowledgeAnswerer } from '@/project-knowledge/answerer.js';

const defaultFreshness: FreshnessMetadata = {
  stale_sources: [],
  drift_detected: false,
};

const canonicalFile: EvidenceFile = {
  path: 'docs/modules/context/index/summary.md',
  source_class: 'canonical-doc',
  excerpt: 'Semantic loading keeps the context budget efficient.',
  score: 3,
};

const frameworkFile: EvidenceFile = {
  path: '.paqad/project-profile.yaml',
  source_class: 'framework-state',
  excerpt: 'stack: laravel',
  score: 1,
};

afterEach(() => {
  vi.clearAllMocks();
  mockReadProjectProfile.mockReset();
});

describe('ProjectKnowledgeAnswerer', () => {
  const answerer = new ProjectKnowledgeAnswerer();
  const baseQuery = {
    question: 'How is context handled?',
    mode: 'explain' as const,
    project_root: '/tmp',
  };

  describe('grounding states', () => {
    it('uses the explicit mcp_first query flag without consulting the project profile', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      await answerer.answer({ ...baseQuery, mcp_first: true });

      expect(mockReadProjectProfile).not.toHaveBeenCalled();
      expect(mockRetrieve).toHaveBeenCalledWith({ ...baseQuery, mcp_first: true });
    });

    it('returns missing-evidence when no evidence is found', async () => {
      mockRetrieve.mockResolvedValue([]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.grounding_state).toBe('missing-evidence');
      expect(result.citations).toEqual([]);
    });

    it('returns observed when canonical-doc evidence is found', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.grounding_state).toBe('observed');
    });

    it('returns inferred when only framework-state evidence is found', async () => {
      mockRetrieve.mockResolvedValue([frameworkFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.grounding_state).toBe('inferred');
    });

    it('returns inferred when a non-canonical lead citation is followed by canonical support', async () => {
      mockRetrieve.mockResolvedValue([frameworkFile, canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.grounding_state).toBe('inferred');
      expect(result.answer).toContain('This answer is inferred from repository evidence');
      expect(result.confidence_basis).toContain(
        'lead citation (.paqad/project-profile.yaml) is framework-state',
      );
      expect(result.confidence_basis).toContain('supporting canonical docs were also retrieved');
    });

    it('hydrates mcp_first from the project profile when the query omits it', async () => {
      mockReadProjectProfile.mockReturnValue({
        efficiency: {
          mcp_first: true,
        },
      });
      mockRetrieve.mockResolvedValue([frameworkFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      await answerer.answer(baseQuery);

      expect(mockReadProjectProfile).toHaveBeenCalledWith(baseQuery.project_root);
      expect(mockRetrieve).toHaveBeenCalledWith({ ...baseQuery, mcp_first: true });
    });
  });

  describe('answer modes', () => {
    it('quick mode returns short answer', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, mode: 'quick' });

      expect(result.mode).toBe('quick');
      expect(result.answer).toContain('Based on repository evidence');
      expect(result.answer).toContain('Semantic loading keeps the context budget efficient.');
    });

    it('quick mode omits freshness text when no stale sources are present', async () => {
      mockRetrieve.mockResolvedValue([
        {
          ...canonicalFile,
          excerpt: 'x'.repeat(260),
        },
      ]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, mode: 'quick' });

      expect(result.answer).not.toContain('Some cited sources may be stale');
      expect(result.answer).toContain('...');
    });

    it('quick mode includes the first freshness note when sources are stale', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue({
        stale_sources: ['docs/modules/context/index/summary.md'],
        drift_detected: true,
      });
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, mode: 'quick' });

      expect(result.answer).toContain('Some cited sources may be stale');
      expect(result.answer).not.toContain('Current stack drift is detected');
    });

    it('quick mode still appends contradiction notes when freshness notes are absent', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([
        {
          source_a: 'docs/modules/context/index/summary.md',
          source_b: '.paqad/project-profile.yaml',
          description: 'docs and runtime disagree',
        },
      ]);

      const result = await answerer.answer({ ...baseQuery, mode: 'quick' });

      expect(result.answer).toContain('Conflicting evidence exists between');
      expect(result.answer).not.toContain('Some cited sources may be stale');
    });

    it('explain mode returns a grounded answer rather than a retrieval summary', async () => {
      mockRetrieve.mockResolvedValue([
        canonicalFile,
        {
          path: 'docs/modules/context/features/core/technical.md',
          source_class: 'canonical-doc',
          excerpt: 'Retrieval prioritizes canonical docs before secondary evidence.',
          score: 2,
        },
      ]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, mode: 'explain' });

      expect(result.mode).toBe('explain');
      expect(result.answer).toContain('Based on repository evidence');
      expect(result.answer).toContain('Semantic loading keeps the context budget efficient.');
      expect(result.answer).toContain('Supporting evidence');
      expect(result.answer).toContain('docs/modules/context/index/summary.md');
    });

    it('trace mode returns evidence trail', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, mode: 'trace' });

      expect(result.mode).toBe('trace');
      expect(result.answer).toContain('Evidence trail');
    });

    it('trace mode includes contradiction details and empty-excerpt fallbacks', async () => {
      mockRetrieve.mockResolvedValue([
        {
          path: 'docs/modules/context/index/summary.md',
          source_class: 'canonical-doc',
          excerpt: '   ',
          score: 3,
        },
      ]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([
        {
          source_a: 'docs/modules/context/index/summary.md',
          source_b: '.paqad/project-profile.yaml',
          description: 'runtime and docs disagree',
        },
      ]);

      const result = await answerer.answer({ ...baseQuery, mode: 'trace' });

      expect(result.answer).toContain(
        'Relevant evidence was found in docs/modules/context/index/summary.md.',
      );
      expect(result.answer).toContain('Contradictions: runtime and docs disagree');
    });
  });

  describe('citations', () => {
    it('builds citations from evidence files', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].path).toBe(canonicalFile.path);
      expect(result.citations[0].source_class).toBe('canonical-doc');
    });

    it('leaves the citation excerpt undefined when the source excerpt is empty', async () => {
      mockRetrieve.mockResolvedValue([
        {
          ...canonicalFile,
          excerpt: '',
        },
      ]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.citations[0].excerpt).toBeUndefined();
    });
  });

  describe('next_actions', () => {
    it('always includes inspect action', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.next_actions.some((a) => a.includes('Inspect'))).toBe(true);
    });

    it('includes onboard action for missing-evidence', async () => {
      mockRetrieve.mockResolvedValue([]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.next_actions.some((a) => a.includes('onboard'))).toBe(true);
    });

    it('includes update action when stale sources present', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue({ ...defaultFreshness, stale_sources: ['docs/modules/x.md'] });
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.next_actions.some((a) => a.includes('update'))).toBe(true);
    });

    it('includes contradiction action when contradictions detected', async () => {
      const contradiction: Contradiction = {
        source_a: 'a.md',
        source_b: 'b.md',
        description: 'conflict',
      };
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([contradiction]);

      const result = await answerer.answer(baseQuery);

      expect(result.next_actions.some((a) => a.includes('contradiction'))).toBe(true);
    });
  });

  describe('confidence_basis', () => {
    it('is a non-empty string for all grounding states', async () => {
      for (const [evidence, state] of [
        [[], 'missing-evidence'],
        [[canonicalFile], 'observed'],
        [[frameworkFile], 'inferred'],
      ] as [EvidenceFile[], KnowledgeAnswer['grounding_state']][]) {
        mockRetrieve.mockResolvedValue(evidence);
        mockCheck.mockResolvedValue(defaultFreshness);
        mockDetect.mockReturnValue([]);

        const result = await answerer.answer(baseQuery);

        expect(result.grounding_state).toBe(state);
        expect(typeof result.confidence_basis).toBe('string');
        expect(result.confidence_basis.length).toBeGreaterThan(0);
      }
    });

    it('mentions the canonical lead citation for observed state', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.confidence_basis).toContain(
        'lead citation (docs/modules/context/index/summary.md) is a canonical module doc',
      );
    });

    it('mentions inferred sources for inferred state', async () => {
      mockRetrieve.mockResolvedValue([frameworkFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.confidence_basis).toContain('framework-state');
    });

    it('mentions stale or contradictory evidence when present', async () => {
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue({
        stale_sources: ['docs/modules/context/index/summary.md'],
        drift_detected: true,
      });
      mockDetect.mockReturnValue([
        {
          source_a: 'docs/modules/context/index/summary.md',
          source_b: '.paqad/project-profile.yaml',
          description: 'mismatch',
        },
      ]);

      const result = await answerer.answer(baseQuery);

      expect(result.confidence_basis).toContain('Stale cited sources reduce confidence');
      expect(result.confidence_basis).toContain('Detected stack drift');
      expect(result.confidence_basis).toContain('Conflicting evidence is present');
    });
  });

  describe('freshness and contradictions', () => {
    it('forwards freshness from checker', async () => {
      const freshness: FreshnessMetadata = {
        stale_sources: ['docs/modules/x.md'],
        drift_detected: true,
        generated_at: '2026-01-01T00:00:00.000Z',
      };
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(freshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.freshness).toEqual(freshness);
    });

    it('forwards contradictions from detector', async () => {
      const contradiction: Contradiction = {
        source_a: 'a',
        source_b: 'b',
        description: 'mismatch',
      };
      mockRetrieve.mockResolvedValue([canonicalFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([contradiction]);

      const result = await answerer.answer(baseQuery);

      expect(result.contradictions).toEqual([contradiction]);
    });
  });

  describe('missing-evidence answer text', () => {
    it('includes the original question in the answer', async () => {
      mockRetrieve.mockResolvedValue([]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer({ ...baseQuery, question: 'Where is auth?' });

      expect(result.answer).toContain('Where is auth?');
    });
  });

  describe('inferred answer text', () => {
    it('explicitly says the answer is inferred from repository evidence', async () => {
      mockRetrieve.mockResolvedValue([frameworkFile]);
      mockCheck.mockResolvedValue(defaultFreshness);
      mockDetect.mockReturnValue([]);

      const result = await answerer.answer(baseQuery);

      expect(result.answer).toContain('inferred from repository evidence');
      expect(result.answer).toContain('.paqad/project-profile.yaml');
    });
  });
});

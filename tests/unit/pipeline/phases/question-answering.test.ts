import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockAnswer, mockMkdir, mockRename, mockWriteFile } = vi.hoisted(() => ({
  mockAnswer: vi.fn(),
  mockMkdir: vi.fn(),
  mockRename: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('@/project-knowledge/index.js', () => ({
  ProjectKnowledgeAnswerer: vi.fn().mockImplementation(() => ({ answer: mockAnswer })),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  rename: mockRename,
  writeFile: mockWriteFile,
}));

import { ProjectQuestionPhase } from '@/pipeline/phases/question-answering.js';
import { PATHS } from '@/core/constants/paths.js';
import type { PipelineRunContext } from '@/core/types/pipeline.js';

function makeContext(workflow: string): PipelineRunContext {
  return {
    project_root: '/tmp/demo',
    lane: 'fast',
    classification: {
      request_text: 'How is the project tested?',
      domain: 'coding',
      stack: 'laravel',
      workflow: workflow as PipelineRunContext['classification']['workflow'],
      complexity: 'low',
      risk: 'low',
      scope: 'single-module',
      affected_modules: [],
      process_depth: 'fast lane',
      certainty: 'well-defined',
      output_type: 'report',
      database_impact: 'none',
      ui_impact: 'none',
      api_impact: 'none',
      compliance_sensitivity: 'none',
      customer_facing_impact: 'internal',
      reversibility: 'easily-reversible',
      data_sensitivity: 'none',
    },
    started_at: new Date().toISOString(),
    phases: [],
    feature_policy: null,
    policy_warnings: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProjectQuestionPhase', () => {
  it('no-ops when workflow is not project-question', async () => {
    const result = await new ProjectQuestionPhase().execute(makeContext('feature-development'));

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('No project-question workflow requested');
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('calls answerer and includes grounding state in summary', async () => {
    mockAnswer.mockResolvedValue({
      answer: 'The project uses vitest for testing.',
      grounding_state: 'observed',
      citations: [],
      freshness: null,
      contradictions: [],
      next_actions: ['Inspect cited files.'],
      mode: 'explain',
      confidence_basis: 'Based on canonical docs.',
    });

    const result = await new ProjectQuestionPhase().execute(makeContext('project-question'));

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('observed');
    expect(result.summary).toContain('Project question answered');
    expect(mockAnswer).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('includes persisted answer artifact and grounding state in artifacts array', async () => {
    mockAnswer.mockResolvedValue({
      answer: 'No docs found.',
      grounding_state: 'missing-evidence',
      citations: [],
      freshness: null,
      contradictions: [],
      next_actions: [],
      mode: 'explain',
      confidence_basis: 'No evidence found.',
    });

    const result = await new ProjectQuestionPhase().execute(makeContext('project-question'));

    expect(result.artifacts).toContain(PATHS.PROJECT_QUESTION_ANSWER);
    expect(result.artifacts).toContain('answer:missing-evidence');
  });

  it('writes the structured answer contract to the framework-managed artifact path', async () => {
    mockAnswer.mockResolvedValue({
      answer: 'The project uses vitest for testing.',
      grounding_state: 'observed',
      citations: [{ path: 'docs/modules/testing.md', source_class: 'canonical-doc' }],
      freshness: { stale_sources: [], drift_detected: false },
      contradictions: [],
      next_actions: ['Inspect cited files.'],
      mode: 'explain',
      confidence_basis: 'Based on canonical docs.',
    });

    await new ProjectQuestionPhase().execute(makeContext('project-question'));

    expect(mockMkdir).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(`${PATHS.PROJECT_QUESTION_ANSWER}.tmp`),
      expect.stringContaining('"grounding_state": "observed"'),
      'utf8',
    );
    expect(mockRename).toHaveBeenCalledWith(
      expect.stringContaining(`${PATHS.PROJECT_QUESTION_ANSWER}.tmp`),
      expect.stringContaining(PATHS.PROJECT_QUESTION_ANSWER),
    );
  });

  it('truncates long answers in summary to 200 chars', async () => {
    mockAnswer.mockResolvedValue({
      answer: 'A'.repeat(300),
      grounding_state: 'inferred',
      citations: [],
      freshness: null,
      contradictions: [],
      next_actions: [],
      mode: 'explain',
      confidence_basis: 'Inferred.',
    });

    const result = await new ProjectQuestionPhase().execute(makeContext('project-question'));

    // summary format: "Project question answered [inferred]: " + 200 chars of answer
    const prefix = 'Project question answered [inferred]: ';
    expect(result.summary.length).toBe(prefix.length + 200);
  });

  it('phase identifier is question-answering', () => {
    expect(new ProjectQuestionPhase().phase).toBe('question-answering');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGlob, mockReadFile } = vi.hoisted(() => ({
  mockGlob: vi.fn(),
  mockReadFile: vi.fn(),
}));
const { mockGetStatus, mockRetrieveForEval } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockRetrieveForEval: vi.fn(),
}));

vi.mock('fast-glob', () => ({ default: mockGlob }));
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('@/rag/service.js', () => ({
  RagService: vi.fn().mockImplementation(() => ({
    getStatus: mockGetStatus,
    retrieveForEval: mockRetrieveForEval,
  })),
}));

import {
  EvidenceRetriever,
  extractKeywords,
  scoreFile,
} from '@/project-knowledge/evidence-retriever.js';

beforeEach(() => {
  mockGetStatus.mockResolvedValue({
    enabled: false,
    index_present: false,
    valid: false,
    chunk_count: 0,
    size_bytes: 0,
  });
  mockRetrieveForEval.mockResolvedValue({
    vector_scores: new Map(),
    chunks_retrieved: 0,
    retrieved_chunk_ids: [],
    retrieved_source_files: [],
    retrieved_chunks: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  mockGetStatus.mockResolvedValue({
    enabled: false,
    index_present: false,
    valid: false,
    chunk_count: 0,
    size_bytes: 0,
  });
  mockRetrieveForEval.mockResolvedValue({
    vector_scores: new Map(),
    chunks_retrieved: 0,
    retrieved_chunk_ids: [],
    retrieved_source_files: [],
    retrieved_chunks: [],
  });
});

describe('extractKeywords', () => {
  it('splits and lowercases words', () => {
    expect(extractKeywords('How is Testing done')).toContain('testing');
    expect(extractKeywords('How is Testing done')).toContain('done');
  });

  it('filters stop words', () => {
    const kw = extractKeywords('how is the project tested');
    expect(kw).not.toContain('how');
    expect(kw).not.toContain('is');
    expect(kw).not.toContain('the');
  });

  it('filters words shorter than 3 chars', () => {
    const kw = extractKeywords('do it now');
    expect(kw).not.toContain('do');
    expect(kw).not.toContain('it');
    expect(kw).toContain('now');
  });

  it('strips non-alphanumeric characters', () => {
    const kw = extractKeywords('testing? coverage!');
    expect(kw).toContain('testing');
    expect(kw).toContain('coverage');
  });

  it('returns empty array for all stop words', () => {
    expect(extractKeywords('how is it')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('returns empty array for undefined/falsy input', () => {
    expect(extractKeywords(undefined as unknown as string)).toEqual([]);
  });
});

describe('scoreFile', () => {
  it('returns 0 when no keywords', () => {
    expect(scoreFile('docs/test.md', 'some content', [])).toBe(0);
  });

  it('counts keyword matches in path and excerpt', () => {
    expect(scoreFile('docs/testing.md', 'coverage is here', ['testing', 'coverage'])).toBe(2);
  });

  it('returns 0 when nothing matches', () => {
    expect(scoreFile('docs/readme.md', 'hello world', ['nonexistent'])).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(scoreFile('docs/Testing.md', 'Coverage', ['testing', 'coverage'])).toBe(2);
  });
});

describe('EvidenceRetriever', () => {
  const retriever = new EvidenceRetriever();

  it('returns empty array when no files are found', async () => {
    mockGlob.mockResolvedValue([]);
    const result = await retriever.retrieve({
      question: 'How is the project tested?',
      mode: 'explain',
      project_root: '/tmp/project',
    });
    expect(result).toEqual([]);
  });

  it('returns canonical-doc entry for docs/modules file', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md')
        return Promise.resolve(['docs/modules/context/index/summary.md']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('# Context Summary\nSemantic loading and retrieval.');

    const result = await retriever.retrieve({
      question: 'context retrieval',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('canonical-doc');
    expect(result[0].path).toBe('docs/modules/context/index/summary.md');
  });

  it('prefers semantic RAG-backed chunks when a valid index is available', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([['chunk-1', 0.92]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['chunk-1'],
      retrieved_source_files: ['docs/modules/context/index/summary.md'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: 'docs/modules/context/index/summary.md',
          content:
            'Semantic loading keeps the framework from wasting context budget on irrelevant full-file loads.',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'does rag retrieve useful project context',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(mockRetrieveForEval).toHaveBeenCalledWith(
      {
        taskDescription: 'does rag retrieve useful project context',
        keywords: ['does', 'rag', 'retrieve', 'useful', 'project', 'context'],
      },
      6,
    );
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('docs/modules/context/index/summary.md');
    expect(result[0].source_class).toBe('canonical-doc');
  });

  it('skips duplicate semantic files and semantic chunks with unsupported source classes', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([
        ['chunk-1', 0.92],
        ['chunk-2', 0.75],
        ['chunk-3', 0.66],
      ]),
      chunks_retrieved: 3,
      retrieved_chunk_ids: ['chunk-1', 'chunk-2', 'chunk-3'],
      retrieved_source_files: [
        'docs/modules/context/index/summary.md',
        'docs/modules/context/index/summary.md',
        'tmp/generated.txt',
      ],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: 'docs/modules/context/index/summary.md',
          content: 'Semantic loading keeps project context focused.',
        },
        {
          id: 'chunk-2',
          source_file: 'docs/modules/context/index/summary.md',
          content: 'Duplicate semantic chunk for the same file should be ignored.',
        },
        {
          id: 'chunk-3',
          source_file: 'tmp/generated.txt',
          content: 'Unsupported sources should be skipped.',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'project context',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('docs/modules/context/index/summary.md');
    expect(result[0].source_class).toBe('canonical-doc');
  });

  it('classifies semantic workflow and code chunks using path-based source detection', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([
        ['chunk-1', 0.92],
        ['chunk-2', 0.88],
      ]),
      chunks_retrieved: 2,
      retrieved_chunk_ids: ['chunk-1', 'chunk-2'],
      retrieved_source_files: ['.github/workflows/ci.yml', 'src/cli/index.ts'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: '.github/workflows/ci.yml',
          content: 'coverage workflow checks project status',
        },
        {
          id: 'chunk-2',
          source_file: 'src/cli/index.ts',
          content: 'project cli command status output',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'project status',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '.github/workflows/ci.yml',
          source_class: 'workflow',
        }),
        expect.objectContaining({
          path: 'src/cli/index.ts',
          source_class: 'code',
        }),
      ]),
    );
  });

  it('classifies semantic workflow chunks for yaml extensions', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([['chunk-1', 0.92]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['chunk-1'],
      retrieved_source_files: ['.github/workflows/release.yaml'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: '.github/workflows/release.yaml',
          content: 'release workflow for project status checks',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'project status',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toEqual([
      expect.objectContaining({
        path: '.github/workflows/release.yaml',
        source_class: 'workflow',
      }),
    ]);
  });

  it('classifies semantic framework-state and manifest chunks using path-based source detection', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([
        ['chunk-1', 0.92],
        ['chunk-2', 0.88],
      ]),
      chunks_retrieved: 2,
      retrieved_chunk_ids: ['chunk-1', 'chunk-2'],
      retrieved_source_files: ['.paqad/project-profile.yaml', 'package.json'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: '.paqad/project-profile.yaml',
          content: 'project profile status and framework state',
        },
        {
          id: 'chunk-2',
          source_file: 'package.json',
          content: 'project package manifest status',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'project status',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '.paqad/project-profile.yaml',
          source_class: 'framework-state',
        }),
        expect.objectContaining({
          path: 'package.json',
          source_class: 'manifest',
        }),
      ]),
    );
  });

  it('classifies semantic generated instruction chunks using path-based source detection', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: true,
      valid: true,
      chunk_count: 10,
      size_bytes: 1024,
    });
    mockRetrieveForEval.mockResolvedValue({
      vector_scores: new Map([['chunk-1', 0.92]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['chunk-1'],
      retrieved_source_files: ['docs/instructions/rules/testing.md'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: 'docs/instructions/rules/testing.md',
          content: 'testing rules for project status and coverage',
        },
      ],
    });

    const result = await retriever.retrieve({
      question: 'project status',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toEqual([
      expect.objectContaining({
        path: 'docs/instructions/rules/testing.md',
        source_class: 'generated-instruction',
      }),
    ]);
  });

  it('falls back to lexical retrieval when RAG is unavailable', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      index_present: false,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') {
        return Promise.resolve(['docs/modules/context/index/summary.md']);
      }
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('# Context Summary\nSemantic loading and retrieval.');

    const result = await retriever.retrieve({
      question: 'context retrieval',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(mockRetrieveForEval).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('docs/modules/context/index/summary.md');
  });

  it('returns empty array when all candidate scores are zero', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') {
        return Promise.resolve(['docs/modules/context/index/summary.md']);
      }
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('# Context Summary\nSemantic loading and retrieval.');

    const result = await retriever.retrieve({
      question: 'billing invoices refunds',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toEqual([]);
  });

  it('assigns correct source_class per pattern', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      const map: Record<string, string[]> = {
        'docs/modules/**/*.md': ['docs/modules/foo/summary.md'],
        'docs/instructions/**/*.md': ['docs/instructions/rules/testing.md'],
        '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml'],
        '{package.json,composer.json,go.mod,Cargo.toml,pyproject.toml,pom.xml}': ['package.json'],
        '.github/workflows/**/*.{yml,yaml}': ['.github/workflows/ci.yml'],
        'src/**/*.{ts,js}': [],
        'app/**/*.{ts,js}': [],
        'lib/**/*.{ts,js}': [],
      };
      return Promise.resolve(map[pattern] ?? []);
    });
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('docs/modules/foo/summary.md'))
        return Promise.resolve('foo module coverage');
      if (path.includes('docs/instructions/rules/testing.md'))
        return Promise.resolve('testing workflow coverage');
      if (path.includes('.paqad/project-profile.yaml'))
        return Promise.resolve('project coverage state');
      if (path.includes('package.json')) return Promise.resolve('{"coverage":"enabled"}');
      if (path.includes('.github/workflows/ci.yml'))
        return Promise.resolve('name: coverage checks');
      return Promise.resolve('');
    });

    const result = await retriever.retrieve({
      question: 'coverage',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    const classes = result.map((r) => r.source_class);
    expect(classes).toContain('canonical-doc');
    expect(classes).toContain('generated-instruction');
    expect(classes).toContain('framework-state');
    expect(classes).toContain('manifest');
    expect(classes).toContain('workflow');
  });

  it('returns code source_class for src/**/*.ts files', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'src/**/*.{ts,js}') return Promise.resolve(['src/utils/helper.ts']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('export function helper() { return authentication; }');

    const result = await retriever.retrieve({
      question: 'authentication helper',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('code');
    expect(result[0].path).toBe('src/utils/helper.ts');
  });

  it('returns code source_class for app/**/*.ts files', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'app/**/*.{ts,js}') return Promise.resolve(['app/api/router.ts']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue(
      'export const router = createRouter(); // authentication routes',
    );

    const result = await retriever.retrieve({
      question: 'authentication router',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('code');
    expect(result[0].path).toBe('app/api/router.ts');
  });

  it('returns code source_class for lib/**/*.ts files', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'lib/**/*.{ts,js}') return Promise.resolve(['lib/crypto/hash.ts']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('export function hashPassword(password: string) {}');

    const result = await retriever.retrieve({
      question: 'hashPassword crypto',
      mode: 'explain',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('code');
    expect(result[0].path).toBe('lib/crypto/hash.ts');
  });

  it('returns code source_class for .js files in src', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'src/**/*.{ts,js}') return Promise.resolve(['src/legacy/util.js']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('function utilHelper() { return authentication; }');

    const result = await retriever.retrieve({
      question: 'authentication utilHelper',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('code');
    expect(result[0].path).toBe('src/legacy/util.js');
  });

  it('prefers docs over code when scores are equal', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') return Promise.resolve(['docs/modules/auth.md']);
      if (pattern === 'src/**/*.{ts,js}') return Promise.resolve(['src/auth/service.ts']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('authentication service');

    const result = await retriever.retrieve({
      question: 'authentication service',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(2);
    expect(result[0].source_class).toBe('canonical-doc');
    expect(result[1].source_class).toBe('code');
  });

  it('includes code results as fallback when no docs match', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') return Promise.resolve(['docs/modules/unrelated.md']);
      if (pattern === 'src/**/*.{ts,js}') return Promise.resolve(['src/billing/invoice.ts']);
      return Promise.resolve([]);
    });
    mockReadFile.mockImplementation((path: string) => {
      if ((path as string).includes('unrelated.md')) return Promise.resolve('some other topic');
      return Promise.resolve('billing invoice generation logic');
    });

    const result = await retriever.retrieve({
      question: 'billing invoice',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].source_class).toBe('code');
    expect(result[0].path).toBe('src/billing/invoice.ts');
  });

  it('caps results at 6', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') {
        return Promise.resolve([
          'docs/modules/a.md',
          'docs/modules/b.md',
          'docs/modules/c.md',
          'docs/modules/d.md',
          'docs/modules/e.md',
          'docs/modules/f.md',
          'docs/modules/g.md',
          'docs/modules/h.md',
        ]);
      }
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('anything keyword content');

    const result = await retriever.retrieve({
      question: 'anything keyword',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(6);
  });

  it('ranks by keyword score descending', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') {
        return Promise.resolve([
          'docs/modules/billing.md',
          'docs/modules/auth.md',
          'docs/modules/auth-billing.md',
        ]);
      }
      return Promise.resolve([]);
    });
    mockReadFile.mockImplementation((p: string) => {
      if ((p as string).includes('auth')) return Promise.resolve('authentication login jwt');
      if ((p as string).includes('billing')) return Promise.resolve('billing payments');
      return Promise.resolve('authentication billing jwt');
    });

    const result = await retriever.retrieve({
      question: 'authentication jwt billing',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result.map((entry) => entry.path)).toEqual([
      'docs/modules/auth-billing.md',
      'docs/modules/auth.md',
      'docs/modules/billing.md',
    ]);
  });

  it('handles readFile errors gracefully (empty excerpt)', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md') return Promise.resolve(['docs/modules/x.md']);
      return Promise.resolve([]);
    });
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await retriever.retrieve({
      question: 'something',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toEqual([]);
  });

  it('sorts by source_class priority when scores are equal', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      const map: Record<string, string[]> = {
        'docs/modules/**/*.md': ['docs/modules/a.md'],
        '{package.json,composer.json,go.mod,Cargo.toml,pyproject.toml,pom.xml}': ['package.json'],
      };
      return Promise.resolve(map[pattern] ?? []);
    });
    mockReadFile.mockResolvedValue('content zzz');

    const result = await retriever.retrieve({
      question: 'zzz',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    // Both have score 0, canonical-doc should come first by priority order
    expect(result[0].source_class).toBe('canonical-doc');
    expect(result[1].source_class).toBe('manifest');
  });

  it('falls back to the leading excerpt when keywords only match the path', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md')
        return Promise.resolve(['docs/modules/context-auth.md']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue(
      'This content intentionally omits the path keyword so the excerpt falls back to the opening text.',
    );

    const result = await retriever.retrieve({
      question: 'context-auth',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toContain('This content intentionally omits the path keyword');
  });

  it('returns an empty excerpt when the file content is blank but the path matches', async () => {
    mockGlob.mockImplementation((pattern: string) => {
      if (pattern === 'docs/modules/**/*.md')
        return Promise.resolve(['docs/modules/auth-blank.md']);
      return Promise.resolve([]);
    });
    mockReadFile.mockResolvedValue('   \n   ');

    const result = await retriever.retrieve({
      question: 'auth-blank',
      mode: 'quick',
      project_root: '/tmp/project',
    });

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toBe('');
  });

  describe('mcp_first ordering', () => {
    it('places framework-state before canonical-doc when mcp_first is true and scores are equal', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockResolvedValue('auth keyword');

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
        mcp_first: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0].source_class).toBe('framework-state');
      expect(result[1].source_class).toBe('canonical-doc');
    });

    it('does not reorder when mcp_first is false and scores are equal', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockResolvedValue('auth keyword');

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
        mcp_first: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0].source_class).toBe('canonical-doc');
      expect(result[1].source_class).toBe('framework-state');
    });

    it('does not reorder when mcp_first is undefined and scores are equal', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockResolvedValue('auth keyword');

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
      });

      expect(result).toHaveLength(2);
      expect(result[0].source_class).toBe('canonical-doc');
      expect(result[1].source_class).toBe('framework-state');
    });

    it('score ordering still takes precedence over mcp_first', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockImplementation((path: string) => {
        // canonical-doc gets a higher score (two keyword matches) vs framework-state (one)
        if ((path as string).includes('docs/modules/auth.md'))
          return Promise.resolve('auth keyword extra');
        return Promise.resolve('auth content');
      });

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
        mcp_first: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0].source_class).toBe('canonical-doc');
      expect(result[1].source_class).toBe('framework-state');
    });

    it('places multiple framework-state results before non-mcp results when mcp_first is true', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '.paqad/**/*.{json,yaml,yml}': ['.paqad/project-profile.yaml', '.paqad/settings.json'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockResolvedValue('auth keyword');

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
        mcp_first: true,
      });

      expect(result).toHaveLength(3);
      expect(result[0].source_class).toBe('framework-state');
      expect(result[1].source_class).toBe('framework-state');
      expect(result[2].source_class).toBe('canonical-doc');
    });

    it('falls back to source-class ordering when mcp_first is true but neither result is framework-state', async () => {
      mockGlob.mockImplementation((pattern: string) => {
        const map: Record<string, string[]> = {
          'docs/modules/**/*.md': ['docs/modules/auth.md'],
          '{package.json,composer.json,go.mod,Cargo.toml,pyproject.toml,pom.xml}': ['package.json'],
        };
        return Promise.resolve(map[pattern] ?? []);
      });
      mockReadFile.mockResolvedValue('auth keyword');

      const result = await retriever.retrieve({
        question: 'auth keyword',
        mode: 'quick',
        project_root: '/tmp/project',
        mcp_first: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0].source_class).toBe('canonical-doc');
      expect(result[1].source_class).toBe('manifest');
    });
  });
});

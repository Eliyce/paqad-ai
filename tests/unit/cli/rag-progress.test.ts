import { createRagProgressReporter, renderRagIntroPanel } from '@/cli/ui/rag-progress.js';

describe('rag progress ui', () => {
  it('renders a styled onboarding panel for the optional RAG explainer', () => {
    const panel = renderRagIntroPanel();

    expect(panel).toContain('OPTIONAL PROJECT INTELLIGENCE');
    expect(panel).toContain('Retrieval-Augmented Generation (RAG)');
    expect(panel).toContain('Pulls the most relevant code and docs into each task');
  });

  it('groups provider updates into staged progress output', () => {
    const writes: string[] = [];
    const report = createRagProgressReporter((message) => writes.push(message));

    report({ phase: 'load', message: 'Preparing local embedding model Xenova/all-MiniLM-L6-v2' });
    report({
      phase: 'download',
      message: 'Downloading local model Xenova/all-MiniLM-L6-v2',
      percent: 50,
    });
    report({
      phase: 'build',
      message: 'Discovering repository files for RAG eligibility',
    });
    report({
      phase: 'build',
      message: 'Filtering 120 discovered files with RAG rules',
      percent: 0,
    });
    report({
      phase: 'build',
      message: 'Chunking 12 source files',
      percent: 0,
    });
    report({
      phase: 'build',
      message: 'Embedded 16/32 chunks with Xenova/all-MiniLM-L6-v2 (ETA 2s)',
      percent: 50,
    });
    report({
      phase: 'build',
      message: 'Refreshing shared pattern vectors',
    });

    expect(writes).toEqual([
      expect.stringContaining('[1/4] Preparing embedding runtime'),
      expect.stringContaining('Preparing local embedding model Xenova/all-MiniLM-L6-v2'),
      expect.stringContaining(' 50%  Downloading local model Xenova/all-MiniLM-L6-v2'),
      expect.stringContaining('[2/4] Discovering, filtering, and chunking the codebase'),
      expect.stringContaining('Discovering repository files for RAG eligibility'),
      expect.stringContaining('  0%  Filtering 120 discovered files with RAG rules'),
      expect.stringContaining('  0%  Chunking 12 source files'),
      expect.stringContaining('[3/4] Generating embeddings and vector data'),
      expect.stringContaining(' 50%  Embedded 16/32 chunks with Xenova/all-MiniLM-L6-v2 (ETA 2s)'),
      expect.stringContaining('[4/4] Finalizing RAG indexes and metadata'),
      expect.stringContaining('Refreshing shared pattern vectors'),
    ]);
  });
});

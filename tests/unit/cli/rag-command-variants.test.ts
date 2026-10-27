import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RagService } from '@/rag/service.js';

async function run(args: string[]): Promise<void> {
  const { createRagCommand } = await import('@/cli/commands/rag.js');
  await createRagCommand().parseAsync(['node', 'rag', ...args], { from: 'node' });
}

describe('rag command variants', () => {
  let root: string;
  let stdout: string[];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rag-variants-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    stdout = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const knowledge = await import('@/code-knowledge/refresh.js');
    vi.spyOn(knowledge, 'refreshCodeKnowledgeIndex').mockResolvedValue(undefined as never);
    const ruleContext = await import('@/context/rule-context.js');
    vi.spyOn(ruleContext, 'refreshRuleContext').mockResolvedValue('/ctx/session-context.md');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  function config(text: string): void {
    writeFileSync(join(root, '.paqad/.config'), text);
  }

  it('names the written file when RAG is off', async () => {
    config('rag_enabled=false\n');
    await run(['refresh-context', '--project-root', root]);
    expect(stdout.join('')).toBe('wrote /ctx/session-context.md; rule-only (rag off)\n');
  });

  it('names the written file when the saved provider was removed', async () => {
    config('rag_enabled=true\nrag_embedding_provider=voyageai\n');
    await run(['refresh-context', '--project-root', root]);
    expect(stdout.join('')).toBe(
      'wrote /ctx/session-context.md; rule-only (embedding provider removed)\n',
    );
  });

  it('skips rules, retrieval, memory and drift for a no-workflow route', async () => {
    config('rag_enabled=true\nrag_embedding_provider=local\n');
    const route = await import('@/pipeline/session-route.js');
    vi.spyOn(route, 'readSessionRoute').mockReturnValue({ workflow: 'no-workflow', query: 'hi' });
    const sync = await import('@/rag/background-sync.js');
    vi.spyOn(sync, 'backgroundIndexSync').mockResolvedValue({ synced: true });
    const retrieval = await import('@/context/retrieval-context.js');
    const gather = vi.spyOn(retrieval, 'gatherWorkingSetSlices');
    const recorder = await import('@/rag-ledger/recorder.js');
    const record = vi.spyOn(recorder, 'recordRagEvidence').mockReturnValue(null);

    await run(['refresh-context', '--project-root', root]);

    expect(gather).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(stdout.join('')).toBe('wrote /ctx/session-context.md; index sync: done; slices: 0\n');
  });

  it('records memory and drift sections and the sync reason when it could not sync', async () => {
    config('rag_enabled=true\nrag_embedding_provider=local\n');
    const sync = await import('@/rag/background-sync.js');
    vi.spyOn(sync, 'backgroundIndexSync').mockResolvedValue({ synced: false, reason: 'no-index' });
    const retrieval = await import('@/context/retrieval-context.js');
    vi.spyOn(retrieval, 'gatherWorkingSetSlices').mockResolvedValue({
      slices: [],
      bestScore: null,
    });
    const memory = await import('@/context/codebase-memory.js');
    vi.spyOn(memory, 'gatherCodebaseMemory').mockReturnValue('## Memory\n- a fact');
    const drift = await import('@/rag/base-drift.js');
    vi.spyOn(drift, 'refreshBaseDrift').mockResolvedValue(undefined);
    vi.spyOn(drift, 'loadBaseDrift').mockReturnValue(null);
    vi.spyOn(drift, 'composeBaseDriftSection').mockReturnValue('## Drift\n- main moved');
    const recorder = await import('@/rag-ledger/recorder.js');
    const record = vi.spyOn(recorder, 'recordRagEvidence').mockReturnValue(null);

    await run(['refresh-context', '--project-root', root]);

    const used = record.mock.calls.find((call) => call[1] === 'used')?.[2] as {
      injected: boolean;
      injected_sections: string[];
    };
    expect(used.injected).toBe(true);
    expect(used.injected_sections).toEqual(['rules', 'memory', 'drift']);
    expect(stdout.join('')).toContain('index sync: no-index');
  });

  it('AC-59: refresh-context syncs once and asks the slice gather to skip its own sync', async () => {
    config('rag_enabled=true\nrag_embedding_provider=local\n');
    const sync = await import('@/rag/background-sync.js');
    const backgroundSync = vi
      .spyOn(sync, 'backgroundIndexSync')
      .mockResolvedValue({ synced: true });
    const retrieval = await import('@/context/retrieval-context.js');
    const gather = vi
      .spyOn(retrieval, 'gatherWorkingSetSlices')
      .mockResolvedValue({ slices: [], bestScore: null });
    const memory = await import('@/context/codebase-memory.js');
    vi.spyOn(memory, 'gatherCodebaseMemory').mockReturnValue('');
    const drift = await import('@/rag/base-drift.js');
    vi.spyOn(drift, 'refreshBaseDrift').mockResolvedValue(undefined);
    vi.spyOn(drift, 'loadBaseDrift').mockReturnValue(null);
    const recorder = await import('@/rag-ledger/recorder.js');
    vi.spyOn(recorder, 'recordRagEvidence').mockReturnValue(null);

    await run(['refresh-context', '--project-root', root]);

    expect(backgroundSync).toHaveBeenCalledTimes(1);
    expect(gather).toHaveBeenCalledWith(root, expect.objectContaining({ skipSync: true }));
  });

  it('AC-57: refresh-context skips while another refresh holds the lock', async () => {
    config('rag_enabled=false\n');
    mkdirSync(join(root, '.paqad/locks/refresh-context.lock'), { recursive: true });
    const ruleContext = await import('@/context/rule-context.js');

    await run(['refresh-context', '--project-root', root]);

    expect(ruleContext.refreshRuleContext).not.toHaveBeenCalled();
    expect(stdout.join('')).toBe('another refresh-context is running; skipped\n');
    expect(existsSync(join(root, '.paqad/locks/refresh-context.lock'))).toBe(true);
  });

  it('FR-40: refresh-context holds the lock for the run and releases it', async () => {
    config('rag_enabled=false\n');
    const lock = join(root, '.paqad/locks/refresh-context.lock');
    const ruleContext = await import('@/context/rule-context.js');
    let heldDuringRun = false;
    vi.mocked(ruleContext.refreshRuleContext).mockImplementation(async () => {
      heldDuringRun = existsSync(lock);
      return '/ctx/session-context.md';
    });

    await run(['refresh-context', '--project-root', root]);

    expect(heldDuringRun).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('FR-40: refresh-context releases the lock when the run throws', async () => {
    config('rag_enabled=false\n');
    const ruleContext = await import('@/context/rule-context.js');
    vi.mocked(ruleContext.refreshRuleContext).mockRejectedValue(new Error('boom'));

    await expect(run(['refresh-context', '--project-root', root])).rejects.toThrow('boom');

    expect(existsSync(join(root, '.paqad/locks/refresh-context.lock'))).toBe(false);
  });

  it('probes with the default count when the given one is not a positive number', async () => {
    const probe = vi.spyOn(RagService.prototype, 'probe').mockResolvedValue([]);
    await run(['probe', 'query', '--project-root', root, '--top-n', 'lots']);
    expect(probe).toHaveBeenCalledWith({ taskDescription: 'query', keywords: [] }, 10);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ candidates: 0, best_score: null });
  });

  it('keeps a zero exit code when the feature on/off gate passes', async () => {
    vi.spyOn(RagService.prototype, 'refreshContext').mockResolvedValue({
      index: { version: 1, generated_at: '', entries: [] },
      changed_files: [],
      added_files: [],
      deleted_files: [],
      updated: false,
    });
    vi.spyOn(RagService.prototype, 'retrieve').mockResolvedValue({
      vector_scores: new Map(),
      chunks_retrieved: 0,
      retrieved_chunk_ids: [],
      retrieved_source_files: [],
      retrieved_chunks: [],
    });
    const evalRunner = await import('@/rag/eval-runner.js');
    vi.spyOn(evalRunner, 'runFeatureOffVsOnGate').mockReturnValue({
      off: {},
      on: {},
      comparison: { evaluation: { passed: true } },
    } as never);

    await run(['eval', '--project-root', root, '--mode', 'feature-off-vs-on']);

    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ gate_passed: true });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRagEvidenceCommand } from '@/cli/commands/rag-evidence.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

async function run(root: string, args: string[]): Promise<string> {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  try {
    await createRagEvidenceCommand().parseAsync(
      ['node', 'rag-evidence', ...args, '--project-root', root],
      { from: 'node' },
    );
  } finally {
    spy.mockRestore();
  }
  return out.join('');
}

describe('rag-evidence CLI', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rev-'));
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('record writes a structured event the ledger reads back', async () => {
    await run(root, [
      'record',
      'used',
      '--session',
      'ses_cli',
      '--rag-enabled',
      '--open',
      '--json',
      JSON.stringify({
        injected: true,
        injected_sections: ['rules'],
        slice_count: 2,
        score_top: 0.7,
      }),
    ]);
    const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_cli');
    expect(rows.map((r) => r.kind)).toEqual(['open', 'used']);
    expect(rows[1]).toMatchObject({ injected: true, slice_count: 2 });
  });

  it('show --format json folds the session', async () => {
    await run(root, [
      'record',
      'used',
      '--session',
      'ses_cli',
      '--rag-enabled',
      '--open',
      '--json',
      '{"injected":true,"injected_sections":["rules"]}',
    ]);
    const out = await run(root, ['show', '--session', 'ses_cli', '--format', 'json']);
    const fold = JSON.parse(out);
    expect(fold.session_id).toBe('ses_cli');
    expect(fold.totals.used_count).toBe(1);
    expect(fold.coverage.prompts_with_rag).toBe(1);
  });

  it('show summary speaks paqad voice and states the honest limit', async () => {
    await run(root, [
      'record',
      'fallback',
      '--session',
      'ses_v',
      '--open',
      '--json',
      '{"fallback_reason":"below-floor"}',
    ]);
    const out = await run(root, ['show', '--session', 'ses_v']);
    expect(out).toContain('▸ paqad');
    expect(out).toContain('RAG evidence for session ses_v');
    expect(out).toContain('not of benefit');
  });

  it('rejects an invalid record kind', async () => {
    await run(root, ['record', 'bogus', '--session', 'ses_x']);
    expect(process.exitCode).toBe(2);
  });

  it('rejects an invalid --format', async () => {
    await run(root, ['show', '--session', 'ses_x', '--format', 'xml']);
    expect(process.exitCode).toBe(2);
  });
});

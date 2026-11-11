import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_VERDICT_RECORD, createStatusCommand } from '@/cli/commands/status.js';
import { hudVerdictPath } from '@/hud/files.js';
import { readHudVerdict, type HudVerdictRecord } from '@/hud/receipt-file.js';

const SESSION = 'ses-verdict';
let root: string;
let writes: string[];

const RECORD: HudVerdictRecord = {
  schema: 'paqad.hud-verdict/1',
  session_id: SESSION,
  change: 'a-change',
  word: 'Inconclusive',
  kind: 'inconclusive',
  passed: false,
  reasons: ['checks: no record for checks', 'review: review did not finish'],
  record_gaps: ['Checks has no recorded work'],
  written_at: '2026-11-11T16:20:00.000Z',
};

function putVerdict(text: string): void {
  const path = hudVerdictPath(root, SESSION);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

async function status(...args: string[]): Promise<string> {
  await createStatusCommand().parseAsync(
    ['--verdict', '--session', SESSION, '--project-root', root, ...args],
    { from: 'user' },
  );
  return writes.join('');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'status-verdict-'));
  writes = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('AC-17: paqad-ai status --verdict prints the verdict record', () => {
  it("prints the file's verdict word first, then its reasons", async () => {
    putVerdict(JSON.stringify(RECORD));
    const out = await status();
    expect(out.split('\n')[0]).toBe('Inconclusive');
    expect(out).toContain('- checks: no record for checks');
    expect(out).toContain('- review: review did not finish');
    expect(out).toContain('- record gap: Checks has no recorded work');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints json with the word and reasons read through hudVerdictPath', async () => {
    putVerdict(JSON.stringify(RECORD));
    const printed = JSON.parse(await status('--format', 'json')) as Record<string, unknown>;
    expect(printed).toMatchObject({
      status: 'found',
      path: hudVerdictPath(root, SESSION),
      word: 'Inconclusive',
      reasons: RECORD.reasons,
    });
  });

  it('says there is no verdict record and exits non-zero when the file is missing or unreadable', async () => {
    expect(await status()).toContain(NO_VERDICT_RECORD);
    expect(process.exitCode).toBe(1);
    putVerdict('{not json');
    expect(readHudVerdict(root, SESSION)).toMatchObject({ status: 'unreadable' });
    putVerdict(JSON.stringify({ schema: 'other' }));
    expect(readHudVerdict(root, SESSION)).toMatchObject({ status: 'unreadable' });
  });
});

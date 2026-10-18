import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { hudSnapshotPath, writeFileAtomic } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';

describe('HUD files (#639)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-hud-files-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps every HUD file inside the session HUD dir, whatever the session id holds', () => {
    const dir = join(root, PATHS.HUD_DIR);
    expect(hudSnapshotPath(root, 'abc-123')).toBe(join(dir, 'abc-123.json'));
    expect(hudSnapshotPath(root, '../../etc/passwd')).toBe(join(dir, '__.._etc_passwd.json'));
    expect(hudSnapshotPath(root, '..')).toBe(join(dir, '_.json'));
    expect(hudSnapshotPath(root, '')).toBe(join(dir, 'unknown.json'));
  });

  it('writes atomically and leaves no temp file behind on failure', () => {
    const target = join(root, 'a', 'b.json');
    writeFileAtomic(target, 'one');
    expect(readFileSync(target, 'utf8')).toBe('one');

    // A directory where the file should be makes the rename fail.
    const blocked = join(root, 'blocked');
    mkdirSync(join(blocked, 'x.json'), { recursive: true });
    expect(() => writeFileAtomic(join(blocked, 'x.json'), 'two')).toThrow();
    expect(readdirSync(blocked)).toEqual(['x.json']);
  });
});

describe('writeHudReceipt (#639 Part 6)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-hud-receipt-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('falls back to the summary and derives the kind when the verdict carries neither', () => {
    const written = writeHudReceipt(
      root,
      'ses-1',
      {
        summary: '**▸ paqad** · Needs your attention',
        gates: [
          { gate: 'code-tests-lint', status: 'inconclusive', detail: 'x', remediation: null },
          { gate: 'stage-evidence', status: 'fail', detail: 'y', remediation: null },
          { gate: 'rules-loaded', status: 'pass', detail: 'z', remediation: null },
        ],
      },
      () => new Date('2026-10-18T00:00:00.000Z'),
    );

    expect(readFileSync(written.receiptPath, 'utf8')).toBe('**▸ paqad** · Needs your attention\n');
    expect(written.verdict).toEqual({
      schema: 'paqad.hud-verdict/1',
      session_id: 'ses-1',
      word: 'Needs your attention',
      kind: 'fail',
      passed: false,
      // Failures first, then the inconclusive gates.
      reasons: ['stage-evidence: y', 'code-tests-lint: x'],
      written_at: '2026-10-18T00:00:00.000Z',
    });
    expect(existsSync(written.verdictPath)).toBe(true);
  });

  it('uses the kind the verification already decided', () => {
    const written = writeHudReceipt(root, 'ses-2', {
      summary: 's',
      receipt: 'r',
      gates: [],
      kind: 'inconclusive',
    });
    expect(written.verdict).toMatchObject({ word: 'Inconclusive', passed: false, reasons: [] });
  });
});

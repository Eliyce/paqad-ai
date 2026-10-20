import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { hudReceiptPath, hudSnapshotPath, hudVerdictPath, writeFileAtomic } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import type { RepositoryVerificationVerdict } from '@/verification/repository/verdict.js';

describe('HUD files', () => {
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

    const blocked = join(root, 'blocked');
    mkdirSync(join(blocked, 'x.json'), { recursive: true });
    expect(() => writeFileAtomic(join(blocked, 'x.json'), 'two')).toThrow();
    expect(readdirSync(blocked)).toEqual(['x.json']);
  });
});

describe('writeHudReceipt', () => {
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

    expect(readFileSync(written!.receiptPath, 'utf8')).toBe('**▸ paqad** · Needs your attention\n');
    expect(written!.verdict).toEqual({
      schema: 'paqad.hud-verdict/1',
      session_id: 'ses-1',
      change: null,
      word: 'Needs your attention',
      kind: 'fail',
      passed: false,
      reasons: ['stage-evidence: y', 'code-tests-lint: x'],
      written_at: '2026-10-18T00:00:00.000Z',
    });
    expect(existsSync(written!.verdictPath)).toBe(true);
  });

  it('uses the kind the verification already decided', () => {
    const written = writeHudReceipt(root, 'ses-2', {
      summary: 's',
      receipt: 'r',
      gates: [],
      kind: 'inconclusive',
    });
    expect(written!.verdict).toMatchObject({ word: 'Inconclusive', passed: false, reasons: [] });
  });

  describe('a skipped check', () => {
    const graded = {
      summary: '**▸ paqad** · Needs your attention',
      receipt: '**▸ paqad** · Needs your attention\n> 🔴 stage-evidence: missing [review]',
      gates: [
        { gate: 'stage-evidence', status: 'fail', detail: 'missing', remediation: null },
      ] as RepositoryVerificationVerdict['gates'],
      kind: 'fail' as const,
    };
    const skip = {
      summary: '**▸ paqad** · verification not applicable',
      gates: [],
      applicable: false as const,
    };

    it('AC-6: leaves the previous HUD files byte-identical', () => {
      const first = writeHudReceipt(root, 'ses-skip', graded)!;
      const receiptBefore = readFileSync(first.receiptPath);
      const verdictBefore = readFileSync(first.verdictPath);

      expect(writeHudReceipt(root, 'ses-skip', skip)).toBeNull();

      expect(readFileSync(first.receiptPath).equals(receiptBefore)).toBe(true);
      expect(readFileSync(first.verdictPath).equals(verdictBefore)).toBe(true);
      expect(JSON.parse(verdictBefore.toString('utf8'))).toMatchObject({
        word: 'Needs your attention',
        passed: false,
      });
    });

    it('AC-6: writes no HUD file in a session that has none yet', () => {
      expect(writeHudReceipt(root, 'ses-fresh', skip)).toBeNull();
      expect(existsSync(hudReceiptPath(root, 'ses-fresh'))).toBe(false);
      expect(existsSync(hudVerdictPath(root, 'ses-fresh'))).toBe(false);
    });

    it('AC-7: a verdict with zero gates and no kind writes nothing and returns null', () => {
      expect(writeHudReceipt(root, 'ses-empty', { summary: 's', gates: [] })).toBeNull();
      expect(existsSync(hudVerdictPath(root, 'ses-empty'))).toBe(false);
    });

    it('AC-7: a graded verdict still writes both files', () => {
      const written = writeHudReceipt(root, 'ses-graded', graded);
      expect(written).not.toBeNull();
      expect(existsSync(written!.receiptPath)).toBe(true);
      expect(written!.verdict).toMatchObject({ word: 'Needs your attention', passed: false });
    });
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPendingLane, writePendingLane } from '@/stage-evidence/pending-lane.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

const SESSION = 'sess-lane';

describe('pending-lane stash (#324)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-pending-lane-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a written lane', () => {
    writePendingLane(root, SESSION, 'fast');
    expect(readPendingLane(root, SESSION)).toBe('fast');
    writePendingLane(root, SESSION, 'full');
    expect(readPendingLane(root, SESSION)).toBe('full');
  });

  it('is a no-op for a null lane (no code intent) and reads back null', () => {
    writePendingLane(root, SESSION, null);
    expect(readPendingLane(root, SESSION)).toBeNull();
  });

  it('returns null when no stash exists', () => {
    expect(readPendingLane(root, 'never-written')).toBeNull();
  });

  it('returns null for an unrecognised stashed value (and tolerates casing/whitespace)', () => {
    const dir = join(root, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, SESSION));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.pending-lane'), 'sideways\n', 'utf8');
    expect(readPendingLane(root, SESSION)).toBeNull();

    writeFileSync(join(dir, '.pending-lane'), '  GRADUATED \n', 'utf8');
    expect(readPendingLane(root, SESSION)).toBe('graduated');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTEXT_HASH_ALGO_VERSION } from '@/context/context-hash.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  buildReproducibilityStamp,
  readReproducibilityPredicate,
  readReproducibilityStamp,
  recordReproducibilityStamp,
} from '@/evidence/reproducibility.js';

describe('reproducibility stamp', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-repro-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips a recorded stamp', () => {
    const stamp = buildReproducibilityStamp('deadbeef', '2026-06-12T00:00:00.000Z', {
      model_id: 'anthropic/claude-opus-4-8',
      provider: 'anthropic',
    });
    recordReproducibilityStamp(root, stamp);
    const read = readReproducibilityStamp(root);
    expect(read?.context_hash).toBe('deadbeef');
    expect(read?.determinism).toBe('input-replay');
    expect(read?.algo_version).toBe(CONTEXT_HASH_ALGO_VERSION);
    expect(read?.model_id).toBe('anthropic/claude-opus-4-8');
  });

  it('returns null when no stamp exists', () => {
    expect(readReproducibilityStamp(root)).toBeNull();
    expect(readReproducibilityPredicate(root)).toBeNull();
  });

  it('tolerates a malformed stamp file (degrades to null)', () => {
    mkdirSync(join(root, '.paqad', 'ledger'), { recursive: true });
    writeFileSync(join(root, PATHS.EVIDENCE_CONTEXT_STAMP), '{ not json', 'utf8');
    expect(readReproducibilityStamp(root)).toBeNull();
  });

  it('projects an input-replay predicate from a stamp', () => {
    recordReproducibilityStamp(root, buildReproducibilityStamp('abc123', '2026-06-12T00:00:00.000Z'));
    const predicate = readReproducibilityPredicate(root);
    expect(predicate).toEqual({
      context_hash: 'abc123',
      determinism: 'input-replay',
      algo_version: CONTEXT_HASH_ALGO_VERSION,
      replayable: true,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';

// narrateStageEntry must isolate a narration failure from stage recording: if a ledger
// read throws, the predicate returns null (no line) rather than propagating, so the
// stage-writer hook still records the stage. Force the throw by making the feature
// stage ledger it now reads (issue #339) throw on `currentFeature`.
vi.mock('@/feature-evidence/stage-ledger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/feature-evidence/stage-ledger.js')>()),
  currentFeature: () => {
    throw new Error('ledger unavailable');
  },
}));

describe('narrateStageEntry — soft-fail on a ledger error', () => {
  it('returns null (never throws) when the ledger read fails', async () => {
    const { narrateStageEntry } = await import('@/stage-evidence/narration.js');
    expect(
      narrateStageEntry({ projectRoot: '/tmp/whatever', sessionId: 'ses', targetPath: 'src/a.ts' }),
    ).toBeNull();
  });
});

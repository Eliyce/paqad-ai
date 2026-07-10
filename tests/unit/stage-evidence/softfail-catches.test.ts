import { describe, expect, it, vi } from 'vitest';

// Issue #307 hardening — the stage-evidence module holds a 100% coverage floor,
// including its defensive catch paths: every recorder/ledger failure must degrade
// to "no row, no crash", never to a thrown hook or a wedged agent. Force each
// failure by making the feature-evidence layer these modules now read from (issue
// #339) throw — `currentFeature` is the first ledger touch in each entry point, so a
// throw there exercises the catch. importOriginal keeps every other export real.
vi.mock('@/feature-evidence/stage-ledger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/feature-evidence/stage-ledger.js')>()),
  currentFeature: () => {
    throw new Error('ledger unavailable');
  },
}));

describe('stage-evidence soft-fail catches (ledger unavailable)', () => {
  it('parseAndRecordMarkers returns [] instead of throwing', async () => {
    const { parseAndRecordMarkers } = await import('@/stage-evidence/marker-parse.js');
    const recorded = parseAndRecordMarkers({
      projectRoot: '/tmp/whatever',
      transcriptText: 'paqad:stage planning start',
      sessionId: 'ses',
    });
    expect(recorded).toEqual([]);
  });

  it('recordLiveStageEdit returns null instead of throwing', async () => {
    const { recordLiveStageEdit } = await import('@/stage-evidence/live-writer.js');
    const stage = recordLiveStageEdit({
      projectRoot: '/tmp/whatever',
      sessionId: 'ses',
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    expect(stage).toBeNull();
  });
});

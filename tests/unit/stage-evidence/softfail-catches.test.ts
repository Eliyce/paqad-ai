import { describe, expect, it, vi } from 'vitest';

// Issue #307 hardening — the stage-evidence module holds a 100% coverage floor,
// including its defensive catch paths: every recorder/ledger failure must degrade
// to "no row, no crash", never to a thrown hook or a wedged agent. Force each
// failure by mocking the layer underneath, mirroring narration-softfail.test.ts.
vi.mock('@/session-ledger/ledger.js', () => ({
  currentOrdinal: () => {
    throw new Error('ledger unavailable');
  },
  readSessionUnit: () => [],
  appendSessionRow: () => {
    throw new Error('ledger unavailable');
  },
  openSessionUnit: () => {
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

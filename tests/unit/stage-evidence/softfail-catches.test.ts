import { describe, expect, it, vi } from 'vitest';

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

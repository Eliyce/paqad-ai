import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordLiveStageEdit } from '@/stage-evidence/live-writer.js';
import {
  STAGE_NARRATION,
  markerBatchNarration,
  markerNarrationLine,
  narrateStageEntry,
  stageNarrationLine,
} from '@/stage-evidence/narration.js';
import { STAGE_EVIDENCE_STAGES } from '@/stage-evidence/stages.js';

describe('STAGE_NARRATION + stageNarrationLine', () => {
  it('is total over every stage id, each a non-empty plain-English line', () => {
    for (const stage of STAGE_EVIDENCE_STAGES) {
      const text = STAGE_NARRATION[stage as keyof typeof STAGE_NARRATION];
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('renders the branded status line for a known stage', () => {
    expect(stageNarrationLine('development')).toBe('▸ paqad · building it to the spec');
    expect(stageNarrationLine('checks')).toContain('▸ paqad · ');
  });

  it('returns an empty string for an unknown stage id', () => {
    expect(stageNarrationLine('not-a-stage')).toBe('');
  });
});

// Issue #307 — marker-recorded stages narrate too: narration and ledger are both
// non-negotiable, so a row minted from a `paqad:stage` marker is never silent.
describe('markerNarrationLine + markerBatchNarration', () => {
  it('start reuses the canonical stage phrasing', () => {
    expect(markerNarrationLine('planning', 'start')).toBe(stageNarrationLine('planning'));
  });

  it('end confirms the evidence landed, in plain English', () => {
    const line = markerNarrationLine('documentation_sync', 'end');
    expect(line).toContain('▸ paqad');
    expect(line).toContain('documentation sync done');
    expect(line).toContain('evidence recorded');
  });

  it('returns an empty string for an unknown stage id', () => {
    expect(markerNarrationLine('bogus', 'start')).toBe('');
    expect(markerNarrationLine('bogus', 'end')).toBe('');
  });

  it('joins a batch in recording order, skipping unknown stages', () => {
    const block = markerBatchNarration([
      { stage: 'planning', phase: 'start' },
      { stage: 'bogus', phase: 'start' },
      { stage: 'planning', phase: 'end' },
    ]);
    const lines = block.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(stageNarrationLine('planning'));
    expect(lines[1]).toContain('planning done');
  });

  it('returns an empty string for an empty batch', () => {
    expect(markerBatchNarration([])).toBe('');
  });
});

describe('narrateStageEntry — first-entry predicate (mirrors the live writer)', () => {
  let root: string;
  const SES = 'ses_narr';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-narration-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('narrates a non-stage-bearing edit as null', () => {
    expect(
      narrateStageEntry({ projectRoot: root, sessionId: SES, targetPath: 'pnpm-lock.yaml' }),
    ).toBeNull();
  });

  it('narrates the first edit of a change (no change opened yet)', () => {
    const line = narrateStageEntry({ projectRoot: root, sessionId: SES, targetPath: 'src/a.ts' });
    expect(line).toBe('▸ paqad · building it to the spec');
  });

  it('does NOT re-narrate a stage already entered this change (idempotent)', () => {
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    const second = narrateStageEntry({ projectRoot: root, sessionId: SES, targetPath: 'src/b.ts' });
    expect(second).toBeNull();
  });

  it('narrates a forward transition into a new stage (development → checks)', () => {
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    const line = narrateStageEntry({
      projectRoot: root,
      sessionId: SES,
      targetPath: 'tests/a.test.ts',
    });
    expect(line).toBe(stageNarrationLine('checks'));
  });

  it('does NOT narrate an out-of-order edit (an earlier stage after a later one began)', () => {
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Write',
      targetPath: 'tests/a.test.ts',
    });
    const line = narrateStageEntry({ projectRoot: root, sessionId: SES, targetPath: 'src/a.ts' });
    expect(line).toBeNull();
  });
});

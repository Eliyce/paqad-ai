import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendSessionEvent, readSessionUnit } from '@/session-ledger/ledger.js';
import { foldChange } from '@/stage-evidence/fold.js';
import {
  endStage,
  finalizeStageEvidence,
  openStageEvidence,
  startStage,
} from '@/stage-evidence/index.js';
import { recordLiveStageEdit } from '@/stage-evidence/live-writer.js';
import { parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import { formatValidationError, validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

// Issue #307 hardening — edge branches the 100% stage-evidence floor pins:
// forged ledger rows, artifact-bearing ends, and root-level schema errors must
// all degrade gracefully, never crash the finalize/fold path.
describe('stage-evidence hardening edges', () => {
  let root: string;
  const SES = 'ses_harden';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-se-harden-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finalize survives a forged stage_start row whose stage the recorder cannot end', () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    // A row written around the recorder (hand-forged): the stage id is not in the
    // registry, so the close-out endStage throws — finalize must swallow it and
    // still verify the change instead of crashing the completion hook.
    appendSessionEvent(root, STAGE_EVIDENCE_DOC_TYPE, SES, ordinal, {
      adapter: 'claude-code',
      kind: 'stage_start',
      stage: 'not_a_registry_stage',
      event_status: 'started',
      evidence_source: 'live-mark',
    });
    const result = finalizeStageEvidence(root, {
      adapter: 'backstop',
      sessionId: SES,
      changedFilesCount: 1,
    });
    expect(result).not.toBeNull();
    const rows = readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, ordinal);
    expect(
      rows.some((row) => row.kind === 'stage_end' && row.stage === 'not_a_registry_stage'),
    ).toBe(false);
  });

  it('fold carries a string artifact_digest from an artifact-bearing stage end', () => {
    writeFileSync(join(root, 'artifact.txt'), 'artifact bytes');
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    endStage(
      root,
      'planning',
      { artifactPaths: ['artifact.txt'] },
      { sessionId: SES, ordinal, adapter: 'claude-code' },
    );
    const fold = foldChange(root, SES, ordinal);
    const planning = fold.stages.find((stage) => stage.stage === 'planning');
    expect(planning?.artifact_digest).toMatch(/^sha256-/);
  });

  it('reports a root-level schema error as (root)', () => {
    const errors = validateStageEvidenceRow(42);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.startsWith('(root)'))).toBe(true);
  });

  it('formats every validation-error arm (field path, root path, missing message)', () => {
    expect(formatValidationError({ instancePath: '/kind', message: 'must be string' })).toBe(
      '/kind must be string',
    );
    expect(formatValidationError({ instancePath: '', message: 'must be object' })).toBe(
      '(root) must be object',
    );
    expect(formatValidationError({ instancePath: '/stage' })).toBe('/stage invalid');
  });

  it('the live writer survives a forged open stage the recorder cannot close', () => {
    const { ordinal } = openStageEvidence(root, { sessionId: SES, adapter: 'claude-code' });
    // Pre-code stages recorded (issue #310): the writer defers until planning +
    // specification are on the ledger, so seed them before the edit.
    startStage(root, 'planning', { sessionId: SES, ordinal, adapter: 'claude-code' });
    startStage(root, 'specification', { sessionId: SES, ordinal, adapter: 'claude-code' });
    // A forged, registry-unknown stage_start with no end: the forward-close loop's
    // endStage throws for it — the writer must swallow that and still start the
    // real stage for the edit.
    appendSessionEvent(root, STAGE_EVIDENCE_DOC_TYPE, SES, ordinal, {
      adapter: 'claude-code',
      kind: 'stage_start',
      stage: 'not_a_registry_stage',
      event_status: 'started',
      evidence_source: 'live-mark',
    });
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    expect(stage).toBe('development');
  });

  it('finalize threads a caller-supplied subjectDigest onto the inferred backstop row', () => {
    const result = finalizeStageEvidence(root, {
      adapter: 'backstop',
      sessionId: SES,
      changedFilesCount: 1,
      subjectDigest: 'sha256-feedface',
    });
    expect(result).not.toBeNull();
    const rows = readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, 1);
    expect(
      rows.some((row) => row.kind === 'stage_end' && row.subject_digest === 'sha256-feedface'),
    ).toBe(true);
  });

  it('finalize accepts an explicit null subjectDigest on the backstop row', () => {
    const result = finalizeStageEvidence(root, {
      adapter: 'backstop',
      sessionId: SES,
      changedFilesCount: 1,
      subjectDigest: null,
    });
    expect(result).not.toBeNull();
    const rows = readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, 1);
    expect(rows.some((row) => row.kind === 'stage_end' && row.subject_digest === null)).toBe(true);
  });

  // extractAssistantText edge shapes: top-level role rows (string content), rows
  // with content outside `message`, and non-text content blocks.
  it('parses transcript rows with top-level role and string content', () => {
    const transcript = [
      JSON.stringify({ role: 'assistant', content: 'paqad:stage planning start' }),
      JSON.stringify({
        type: 'assistant',
        content: [{ type: 'text', text: 'paqad:stage planning end' }],
      }),
      JSON.stringify({ role: 'assistant', content: 7 }),
    ].join('\n');
    const recorded = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: transcript,
      sessionId: SES,
    });
    expect(recorded).toEqual([
      { stage: 'planning', phase: 'start' },
      { stage: 'planning', phase: 'end' },
    ]);
  });
});

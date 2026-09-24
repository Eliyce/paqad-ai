import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { recordLiveStageEdit, recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';

// Issue #582 — a stage row records where its session id came from, so the completion
// check can ignore rows written against an id read from the shared cache file.

describe('the row schema accepts an optional session_source (issue #582)', () => {
  const base = {
    schema_version: 1,
    doc_type: 'paqad.stage-evidence',
    kind: 'stage_start',
    session_id: 's1',
    conversation_ordinal: 1,
    ts: '2026-01-01T00:00:00.000Z',
    adapter: 'claude-code',
    agent: 'orchestrator',
    content_hash: 'hash',
  };

  it.each(['host', 'env', 'cache', null])('accepts session_source %s', (source) => {
    expect(validateStageEvidenceRow({ ...base, session_source: source })).toEqual([]);
  });

  it('accepts a row without it (rows written before the field existed)', () => {
    expect(validateStageEvidenceRow(base)).toEqual([]);
  });

  it('rejects an unknown source', () => {
    expect(validateStageEvidenceRow({ ...base, session_source: 'guess' })).not.toEqual([]);
  });
});

describe('writers stamp session_source (issue #582)', () => {
  let root: string;
  const SES = 'ses_source';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-session-source-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function rows() {
    const dir = currentFeature(root, SES);
    return dir ? readFeatureStageUnit(root, dir) : [];
  }

  function seedPreCode(sessionSource?: 'env' | 'cache'): void {
    for (const stage of ['planning', 'specification']) {
      recordMarkedStage(root, { sessionId: SES, sessionSource, stage, phase: 'start' });
      recordMarkedStage(root, { sessionId: SES, sessionSource, stage, phase: 'end' });
    }
  }

  it('stamps every row a marked boundary writes, including the stages it closes', () => {
    seedPreCode('env');
    recordMarkedStage(root, {
      sessionId: SES,
      sessionSource: 'env',
      stage: 'development',
      phase: 'start',
    });
    // A marked review start closes the still-open development stage first.
    recordMarkedStage(root, {
      sessionId: SES,
      sessionSource: 'cache',
      stage: 'review',
      phase: 'start',
    });

    const stageRows = rows().filter((row) => row.kind !== 'open');
    expect(
      stageRows.find((row) => row.kind === 'stage_end' && row.stage === 'development'),
    ).toMatchObject({ session_source: 'cache' });
    expect(
      stageRows.find((row) => row.kind === 'stage_start' && row.stage === 'review'),
    ).toMatchObject({ session_source: 'cache' });
    expect(stageRows.find((row) => row.stage === 'planning')).toMatchObject({
      session_source: 'env',
    });
  });

  it('leaves a marked row unstamped when the caller does not say', () => {
    seedPreCode();
    expect(rows().some((row) => 'session_source' in row)).toBe(false);
  });

  it('stamps host on a live edit that carries the host session id', () => {
    seedPreCode();
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    const development = rows().find(
      (row) => row.kind === 'stage_start' && row.stage === 'development',
    );
    expect(development).toMatchObject({ session_source: 'host' });
  });

  it('leaves a live edit unstamped when no host id was supplied', () => {
    seedPreCode();
    // The cache names SES, so the id-less edit resolves to it.
    resolveSessionId(root, SES);
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: null,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
    });
    const development = rows().find(
      (row) => row.kind === 'stage_start' && row.stage === 'development',
    );
    expect(development).toBeDefined();
    expect(development).not.toHaveProperty('session_source');
  });
});

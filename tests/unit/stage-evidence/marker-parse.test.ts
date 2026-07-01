import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractMarkers, parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import { currentOrdinal, readSessionUnit } from '@/session-ledger/ledger.js';

/** One JSONL transcript line in the Claude shape. */
function msg(role: string, text: string): string {
  return JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } });
}

describe('extractMarkers', () => {
  it('finds line-anchored paqad:stage markers in order', () => {
    const text =
      'intro\nparaqad noise\npaqad:stage planning start\nwork\npaqad:stage planning end\n';
    expect(extractMarkers(text)).toEqual([
      { stage: 'planning', phase: 'start' },
      { stage: 'planning', phase: 'end' },
    ]);
  });

  it('tolerates blockquote/list prefixes but not inline mentions', () => {
    const text = '> paqad:stage review start\nplease do paqad:stage review end inline\n';
    expect(extractMarkers(text)).toEqual([{ stage: 'review', phase: 'start' }]);
  });
});

describe('parseAndRecordMarkers', () => {
  let root: string;
  const SES = 'ses_marker';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-marker-parse-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function rows() {
    const ord = currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, SES);
    return ord > 0 ? readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, ord) : [];
  }

  it('records markers the assistant emitted, script-minting the rows', () => {
    const transcript = [
      msg('assistant', 'Let me plan.\npaqad:stage planning start'),
      msg('assistant', 'Done planning.\npaqad:stage planning end'),
    ].join('\n');

    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: transcript,
      sessionId: SES,
    });
    expect(n).toBe(2);
    const start = rows().find((r) => r.kind === 'stage_start' && r.stage === 'planning');
    expect(start?.evidence_source).toBe('live-mark');
    expect(rows().some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
  });

  it('ignores a marker quoted in a NON-assistant (user) message', () => {
    const transcript = [
      msg('user', 'The contract says to emit paqad:stage planning start — how?'),
      msg('assistant', 'Here is the plan (no marker yet).'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toBe(0);
    expect(rows()).toHaveLength(0);
  });

  it('is idempotent — re-parsing the growing transcript never double-records', () => {
    const transcript = msg('assistant', 'paqad:stage planning start\npaqad:stage planning end');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toBe(2);
    // A later Stop re-parses the same (plus more) transcript → the already-recorded
    // markers are skipped.
    const grown = transcript + '\n' + msg('assistant', 'paqad:stage planning start');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: grown, sessionId: SES }),
    ).toBe(0);
  });

  it('ignores an unknown stage token', () => {
    const transcript = msg('assistant', 'paqad:stage bogus start');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toBe(0);
  });

  it('returns 0 for an empty / missing transcript', () => {
    expect(parseAndRecordMarkers({ projectRoot: root, transcriptText: '', sessionId: SES })).toBe(
      0,
    );
    expect(parseAndRecordMarkers({ projectRoot: root, sessionId: SES })).toBe(0);
  });

  it('skips a malformed JSON line and still reads later assistant markers', () => {
    const transcript = [
      '{ this is not valid json',
      msg('assistant', 'paqad:stage planning start\npaqad:stage planning end'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toBe(2);
  });

  it('tolerates an assistant block with no text (e.g. a tool_use block)', () => {
    const transcript = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }] },
    });
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toBe(0);
  });

  it('falls back to raw text when the transcript is not JSONL', () => {
    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: 'plain text transcript\npaqad:stage planning start\npaqad:stage planning end',
      sessionId: SES,
    });
    expect(n).toBe(2);
  });

  // Issue #265 — the recorded row is attributed to the host that ran, so a
  // cross-provider ledger does not mislabel a Codex/Gemini stage as claude-code.
  it('defaults row attribution to claude-code when no adapter is passed', () => {
    parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: msg('assistant', 'paqad:stage planning start'),
      sessionId: SES,
    });
    expect(rows().every((r) => r.adapter === 'claude-code')).toBe(true);
  });

  it('records a Codex-shaped JSONL transcript, attributing rows to codex-cli', () => {
    const transcript = [
      msg('assistant', 'Planning.\npaqad:stage planning start'),
      msg('assistant', 'Done.\npaqad:stage planning end'),
    ].join('\n');
    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: transcript,
      sessionId: SES,
      adapter: 'codex-cli',
    });
    expect(n).toBe(2);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => r.adapter === 'codex-cli')).toBe(true);
  });

  it('records a Gemini inline prompt_response (plain text), attributing rows to gemini-cli', () => {
    // Gemini's transcript_path is stubbed empty; the record hook falls back to the
    // inline final-message text, which the parser scans as raw text.
    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: 'Final answer.\npaqad:stage review start\npaqad:stage review end',
      sessionId: SES,
      adapter: 'gemini-cli',
    });
    expect(n).toBe(2);
    expect(rows().every((r) => r.adapter === 'gemini-cli')).toBe(true);
  });
});

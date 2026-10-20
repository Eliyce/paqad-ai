import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdirSync } from 'node:fs';

import { existsSync } from 'node:fs';

import { extractMarkers, parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  currentFeature,
  featureStagePath,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

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
    const text = '> paqad:stage development start\nplease do paqad:stage development end inline\n';
    expect(extractMarkers(text)).toEqual([{ stage: 'development', phase: 'start' }]);
  });

  it('parses an artifact path on a stage-end (`end -- <path>`)', () => {
    const text = 'paqad:stage planning start\npaqad:stage planning end -- .paqad/plans/320.md\n';
    expect(extractMarkers(text)).toEqual([
      { stage: 'planning', phase: 'start' },
      { stage: 'planning', phase: 'end', artifactPath: '.paqad/plans/320.md' },
    ]);
  });

  it('ignores an artifact suffix on a start (only an end carries one)', () => {
    expect(extractMarkers('paqad:stage planning start -- x\n')).toEqual([
      { stage: 'planning', phase: 'start' },
    ]);
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
    const dir = currentFeature(root, SES);
    return dir ? readFeatureStageUnit(root, dir) : [];
  }

  function expectHost(adapter: string): void {
    expect(rows().every((r) => !('adapter' in r))).toBe(true);
    expect(readFeatureRecord(root, currentFeature(root, SES)!)?.adapter).toBe(adapter);
  }

  it('returns [] (never throws) when reading the active feature ledger fails', () => {
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, SES, dir);
    mkdirSync(join(root, featureStagePath(dir)), { recursive: true });
    expect(
      parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: 'paqad:stage planning start',
        sessionId: SES,
      }),
    ).toEqual([]);
  });

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
    expect(n).toHaveLength(2);
    const start = rows().find((r) => r.kind === 'stage_start' && r.stage === 'planning');
    expect(start?.evidence_source).toBe('live-mark');
    expect(rows().some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
  });

  it('populates artifact_digest from a real file on an `end -- <path>` marker', () => {
    writeFileSync(join(root, 'findings.md'), '# a real artifact with content\n');
    const transcript = [
      msg('assistant', 'Reviewing.\npaqad:stage development start'),
      msg('assistant', 'Done.\npaqad:stage development end -- findings.md'),
    ].join('\n');
    const recorded = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: transcript,
      sessionId: SES,
    });
    expect(recorded).toContainEqual({
      stage: 'development',
      phase: 'end',
      artifactPath: 'findings.md',
    });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(typeof end?.artifact_digest).toBe('string');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
  });

  it('normalizes an ABSOLUTE in-tree artifact path on a marker', () => {
    writeFileSync(join(root, 'findings.md'), '# a real review with content\n');
    const abs = join(root, 'findings.md');
    const transcript = [
      msg('assistant', 'Reviewing.\npaqad:stage development start'),
      msg('assistant', `Done.\npaqad:stage development end -- ${abs}`),
    ].join('\n');
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    expect(end?.artifact_paths).toEqual(['findings.md']);
  });

  it('drops a non-bundle planning artifact on a marker (records inconclusive)', () => {
    setActiveFeature(root, SES, 'x-01JABCDEFGHJKMNPQRSTVWXYZ0');
    writeFileSync(join(root, 'plan.md'), '# a hand-written plan with content\n');
    const transcript = [
      msg('assistant', 'Planning.\npaqad:stage planning start'),
      msg('assistant', 'Done.\npaqad:stage planning end -- plan.md'),
    ].join('\n');
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
    expect(end).toBeDefined();
    expect(end?.artifact_digest ?? null).toBeNull();
    expect(end?.artifact_paths ?? null).toBeNull();
  });

  it('drops a non-rigid artifact written into a bundle dir on a marker', () => {
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, SES, dir);
    const stray = `.paqad/ledger/feature-evidence/${dir}/scratch-notes.md`;
    mkdirSync(join(root, dirname(stray)), { recursive: true });
    writeFileSync(join(root, stray), '# notes with real content\n');
    const transcript = [
      msg('assistant', 'Building.\npaqad:stage development start'),
      msg('assistant', `Done.\npaqad:stage development end -- ${stray}`),
    ].join('\n');
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(end).toBeDefined();
    expect(end?.artifact_digest ?? null).toBeNull();
    expect(end?.artifact_paths ?? null).toBeNull();
  });

  it('accepts the bundle plan.json on a planning-end marker', () => {
    const dir = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';
    setActiveFeature(root, SES, dir);
    const planRel = featureFilePath(dir, 'plan');
    mkdirSync(join(root, dirname(planRel)), { recursive: true });
    writeFileSync(join(root, planRel), '{"summary":"real plan"}\n');
    const transcript = [
      msg('assistant', 'Planning.\npaqad:stage planning start'),
      msg('assistant', `Done.\npaqad:stage planning end -- ${planRel}`),
    ].join('\n');
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    expect(end?.artifact_paths).toEqual([planRel]);
  });

  it('drops an out-of-tree marker artifact instead of recording a false-absent digest', () => {
    const outside = join(tmpdir(), 'paqad-oot-marker.md');
    writeFileSync(outside, '# real content but out of tree\n');
    const transcript = [
      msg('assistant', 'Planning.\npaqad:stage planning start'),
      msg('assistant', `Done.\npaqad:stage planning end -- ${outside}`),
    ].join('\n');
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
    expect(end).toBeDefined();
    expect(end?.artifact_digest ?? null).toBeNull();
    expect(end?.artifact_paths ?? null).toBeNull();
  });

  it('leaves artifact_digest null when the `end -- <path>` file is missing', () => {
    const transcript = msg(
      'assistant',
      'paqad:stage planning start\npaqad:stage planning end -- does-not-exist.md',
    );
    parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES });
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
    expect(end?.artifact_digest ?? null).toBeNull();
  });

  it('ignores a marker quoted in a NON-assistant (user) message', () => {
    const transcript = [
      msg('user', 'The contract says to emit paqad:stage planning start — how?'),
      msg('assistant', 'Here is the plan (no marker yet).'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toEqual([]);
    expect(rows()).toHaveLength(0);
  });

  it('is idempotent — re-parsing the growing transcript never double-records', () => {
    const transcript = msg('assistant', 'paqad:stage planning start\npaqad:stage planning end');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toHaveLength(2);
    const grown = transcript + '\n' + msg('assistant', 'paqad:stage planning start');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: grown, sessionId: SES }),
    ).toEqual([]);
  });

  it('ignores an unknown stage token', () => {
    const transcript = msg('assistant', 'paqad:stage bogus start');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toEqual([]);
  });

  it('returns no markers for an empty / missing transcript', () => {
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: '', sessionId: SES }),
    ).toEqual([]);
    expect(parseAndRecordMarkers({ projectRoot: root, sessionId: SES })).toEqual([]);
  });

  it('skips a malformed JSON line and still reads later assistant markers', () => {
    const transcript = [
      '{ this is not valid json',
      msg('assistant', 'paqad:stage planning start\npaqad:stage planning end'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toHaveLength(2);
  });

  it('tolerates an assistant block with no text (e.g. a tool_use block)', () => {
    const transcript = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }] },
    });
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toEqual([]);
  });

  it('falls back to raw text when the transcript is not JSONL', () => {
    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: 'plain text transcript\npaqad:stage planning start\npaqad:stage planning end',
      sessionId: SES,
    });
    expect(n).toHaveLength(2);
  });

  function codexMsg(role: string, text: string): string {
    return JSON.stringify({
      timestamp: '2026-07-08T16:09:29.019Z',
      type: 'response_item',
      payload: { type: 'message', role, content: [{ type: 'output_text', text }] },
    });
  }

  it('records markers from Codex rollout payload-nested assistant messages', () => {
    const transcript = [
      codexMsg('assistant', 'Planning.\npaqad:stage planning start'),
      codexMsg('assistant', 'Done.\npaqad:stage planning end'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
        adapter: 'codex-cli',
      }),
    ).toHaveLength(2);
  });

  it('ignores a marker quoted in a Codex user (input) message', () => {
    const transcript = [
      codexMsg('user', 'the contract quotes paqad:stage planning start'),
      codexMsg('assistant', 'acknowledged, no marker'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
        adapter: 'codex-cli',
      }),
    ).toEqual([]);
  });

  it('skips a Codex non-message payload item (reasoning) and still reads later markers', () => {
    const transcript = [
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [] } }),
      codexMsg('assistant', 'paqad:stage planning start\npaqad:stage planning end'),
    ].join('\n');
    expect(
      parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
        adapter: 'codex-cli',
      }),
    ).toHaveLength(2);
  });

  it('reads a bare top-level {role,content} JSONL line (no message/payload wrapper)', () => {
    const transcript = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: 'paqad:stage planning start\npaqad:stage planning end' }],
    });
    expect(
      parseAndRecordMarkers({ projectRoot: root, transcriptText: transcript, sessionId: SES }),
    ).toHaveLength(2);
  });

  it('defaults row attribution to claude-code when no adapter is passed', () => {
    parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: msg('assistant', 'paqad:stage planning start'),
      sessionId: SES,
    });
    expectHost('claude-code');
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
    expect(n).toHaveLength(2);
    expect(rows().length).toBeGreaterThan(0);
    expectHost('codex-cli');
  });

  it('records a Gemini inline prompt_response (plain text), attributing rows to gemini-cli', () => {
    const n = parseAndRecordMarkers({
      projectRoot: root,
      transcriptText: 'Final answer.\npaqad:stage development start\npaqad:stage development end',
      sessionId: SES,
      adapter: 'gemini-cli',
    });
    expect(n).toHaveLength(2);
    expectHost('gemini-cli');
  });

  describe('route gating', () => {
    const transcript = [
      msg('assistant', 'Let me plan.\npaqad:stage planning start'),
      msg('assistant', 'Done planning.\npaqad:stage planning end'),
    ].join('\n');

    it('records NOTHING and mints no bundle for a non-feature route', () => {
      writeWorkflowState(root, SES, { active: { workflow: 'root-cause-analysis' }, paused: [] });
      const recorded = parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
      });
      expect(recorded).toEqual([]);
      expect(currentFeature(root, SES)).toBeNull();
      expect(existsSync(join(root, '.paqad/ledger/feature-evidence'))).toBe(false);
    });

    it('records markers for the feature-development route (unchanged)', () => {
      writeWorkflowState(root, SES, { active: { workflow: 'feature-development' }, paused: [] });
      const recorded = parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
      });
      expect(recorded).toHaveLength(2);
      expect(currentFeature(root, SES)).not.toBeNull();
    });

    it('records markers when NO route state exists (cross-provider safe)', () => {
      const recorded = parseAndRecordMarkers({
        projectRoot: root,
        transcriptText: transcript,
        sessionId: SES,
      });
      expect(recorded).toHaveLength(2);
      expect(currentFeature(root, SES)).not.toBeNull();
    });
  });
});

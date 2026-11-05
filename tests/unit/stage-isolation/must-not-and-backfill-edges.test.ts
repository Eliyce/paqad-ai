import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { judgeMustNot, transcriptToolUses } from '@/stage-isolation/must-not-judge.js';
import {
  backfillStageReports,
  claudeTranscriptFinder,
  readLastReport,
} from '@/stage-isolation/report-backfill.js';

const assistant = (content: unknown): string =>
  JSON.stringify({ message: { role: 'assistant', content } });

describe('reading tool uses out of a transcript', () => {
  it('skips lines and blocks that are not tool uses', () => {
    const raw = [
      'not json at all',
      '{broken json',
      JSON.stringify({ message: { role: 'user', content: [{ type: 'tool_use', name: 'Edit' }] } }),
      assistant('plain text content'),
      assistant([null, 'text', 7, { type: 'text', text: 'hi' }, { type: 'tool_use', name: 9 }]),
    ].join('\n');
    expect(transcriptToolUses(raw)).toEqual([]);
  });

  it('reads the role from a bare type field too', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { a: 1 } }] },
    });
    expect(transcriptToolUses(raw)).toEqual([{ name: 'Read', input: { a: 1 } }]);
  });

  it('keeps a tool use id only when it is text, and an input only when it is an object', () => {
    const raw = assistant([
      { type: 'tool_use', id: 'toolu_1', name: 'A', input: 'not an object' },
      { type: 'tool_use', id: 5, name: 'B' },
    ]);
    expect(transcriptToolUses(raw)).toEqual([
      { id: 'toolu_1', name: 'A', input: {} },
      { name: 'B', input: {} },
    ]);
  });
});

describe('judging what a stage agent did', () => {
  const edit = (input: Record<string, unknown>, name = 'Edit') => ({ name, input });

  it('finds a bundle write through each path field', () => {
    const bundle = '.paqad/ledger/feature-evidence/change-01/plan.json';
    expect(judgeMustNot('development', [edit({ file_path: bundle })])).toEqual(['bundle_write']);
    expect(judgeMustNot('development', [edit({ notebook_path: bundle }, 'NotebookEdit')])).toEqual([
      'bundle_write',
    ]);
    expect(judgeMustNot('development', [edit({ path: bundle }, 'Write')])).toEqual([
      'bundle_write',
    ]);
  });

  it('lets a development edit outside the bundle, and one naming no path', () => {
    expect(judgeMustNot('development', [edit({ file_path: 'src/a.ts' })])).toEqual([]);
    expect(judgeMustNot('development', [edit({ file_path: '   ' })])).toEqual([]);
    expect(judgeMustNot('development', [edit({ file_path: 7 })])).toEqual([]);
  });

  it('calls any edit out of stage in a stage that does not edit', () => {
    expect(judgeMustNot('review', [edit({ file_path: 'src/a.ts' })])).toEqual([
      'out_of_stage_edit',
    ]);
    expect(judgeMustNot('review', [edit({})])).toEqual(['out_of_stage_edit']);
  });

  it('calls an edit out of stage for a stage it does not know', () => {
    expect(judgeMustNot('mystery', [edit({ file_path: 'src/a.ts' })])).toEqual([
      'out_of_stage_edit',
    ]);
  });

  it('reports asking the human, and ignores tools that do not edit', () => {
    expect(
      judgeMustNot('development', [
        { name: 'AskUserQuestion', input: {} },
        { name: 'Read', input: { file_path: '.paqad/ledger/feature-evidence/c/plan.json' } },
      ]),
    ).toEqual(['asked_human']);
  });
});

describe('reading the last report for a backfill', () => {
  it('reads a plain string content as text', () => {
    expect(readLastReport(assistant('Status: DONE'))).toEqual({
      source: 'text',
      text: 'Status: DONE',
    });
  });

  it('reads content of another type as nothing', () => {
    expect(readLastReport(assistant(5))).toBeNull();
  });

  it('skips blank text, and text blocks with no text', () => {
    expect(readLastReport(assistant([{ type: 'text', text: '  ' }, { type: 'text' }]))).toBeNull();
  });

  it('reads a handback with no input as an empty report', () => {
    expect(readLastReport(assistant([{ type: 'tool_use', name: 'SubagentHandback' }]))).toEqual({
      source: 'handback',
      text: '',
    });
  });

  it('skips another tool, a user line and a broken line', () => {
    const raw = [
      '',
      'broken',
      JSON.stringify({ message: { role: 'user', content: 'Status: DONE' } }),
      assistant([{ type: 'tool_use', name: 'Read', input: {} }]),
    ].join('\n');
    expect(readLastReport(raw)).toBeNull();
  });
});

describe('the report backfill', () => {
  const SESSION = 'ses_backfill_edges';
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  const tempRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-backfill-edges-'));
    roots.push(root);
    return root;
  };

  const seed = (root: string, dir: string, agent: string, stage = 'review') => {
    mkdirSync(join(root, featureFilePath(dir, 'stageEvidence'), '..'), { recursive: true });
    appendFeatureStageRow(root, SESSION, dir, {
      kind: 'stage-agent',
      stage,
      agent_id: agent,
      event_status: 'completed',
      report_status: 'BLOCKED',
      report_stated: false,
      report_source: 'none',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });
  };

  it('has nothing to do in a project with no evidence folder', () => {
    expect(
      backfillStageReports({
        projectRoot: tempRoot(),
        sessionId: SESSION,
        since: '2000',
        findTranscript: () => null,
      }),
    ).toEqual([]);
  });

  it('skips a bundle with no ledger, and a transcript holding no report', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad/ledger/feature-evidence/_session'), { recursive: true });
    const dir = 'edges-01JABCDEFGHJKMNPQRSTVWXY40';
    seed(root, dir, 'a1');
    const transcript = join(root, 'empty.jsonl');
    writeFileSync(transcript, assistant([{ type: 'tool_use', name: 'Read', input: {} }]));
    const [change, ...rest] = backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2000',
      findTranscript: () => transcript,
    });
    expect(rest).toEqual([]);
    expect(change).toMatchObject({
      dirName: dir,
      affected_rows: 1,
      note: 'a1 review: transcript found, no report',
      written: false,
    });
    expect(readFeatureStageUnit(root, dir).some((row) => row.kind === 'record-repair')).toBe(false);
  });

  it('notes a transcript path that cannot be read as not found', () => {
    const root = tempRoot();
    const dir = 'edges-01JABCDEFGHJKMNPQRSTVWXY41';
    seed(root, dir, 'a1');
    const [change] = backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2000',
      findTranscript: () => join(root, 'nope.jsonl'),
    });
    expect(change!.note).toBe('a1 review: no transcript found');
  });

  it('joins the stages of one agent and keeps two agents apart', () => {
    const root = tempRoot();
    const dir = 'edges-01JABCDEFGHJKMNPQRSTVWXY42';
    seed(root, dir, 'a1', 'planning');
    seed(root, dir, 'a1', 'specification');
    seed(root, dir, 'a2', 'review');
    const [change] = backfillStageReports({
      projectRoot: root,
      sessionId: SESSION,
      since: '2000',
      findTranscript: () => null,
    });
    expect(change!.affected_rows).toBe(3);
    expect(change!.note).toBe(
      'a1 planning+specification: no transcript found; a2 review: no transcript found',
    );
  });

  describe('claudeTranscriptFinder', () => {
    it('finds nothing with no projects folder', () => {
      expect(claudeTranscriptFinder(tempRoot())('a1', 's1')).toBeNull();
    });

    it('finds the agent transcript in whichever project holds it, and nothing else', () => {
      const home = tempRoot();
      mkdirSync(join(home, '.claude/projects/other'), { recursive: true });
      const folder = join(home, '.claude/projects/this/s1/subagents');
      mkdirSync(folder, { recursive: true });
      const path = join(folder, 'agent-a1.jsonl');
      writeFileSync(path, '');
      const find = claudeTranscriptFinder(home);
      expect(find('a1', 's1')).toBe(path);
      expect(find('a2', 's1')).toBeNull();
    });
  });
});

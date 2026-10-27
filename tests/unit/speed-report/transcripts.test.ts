import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CATEGORY, OWNER_CATEGORY } from '@/speed-report/classify.js';
import {
  isSafeId,
  projectTranscriptSlug,
  readLedgerChanges,
  readTranscriptTimeline,
  resolveChangeDir,
  resolveTranscriptsRoot,
  sessionTranscripts,
} from '@/speed-report/transcripts.js';

import {
  T0,
  assistant,
  at,
  human,
  result,
  speedProject,
  writeBundle,
  writeTranscript,
} from './speed-fixtures.js';

const SESSION = '11111111-2222-3333-4444-555555555555';

function timeline(records: readonly unknown[], agentType: string | null = null) {
  const project = speedProject();
  const path = writeTranscript(project, SESSION, records);
  const built = readTranscriptTimeline({ path, agentType });
  if (!built) throw new Error('timeline missing');
  return built;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcripts root and paths', () => {
  it('resolves the transcripts root from the option, then CLAUDE_CONFIG_DIR, then the home folder', () => {
    expect(resolveTranscriptsRoot({ transcriptsRoot: '/tmp/a' })).toBe(resolve('/tmp/a'));
    expect(resolveTranscriptsRoot({ env: { CLAUDE_CONFIG_DIR: '/cfg' }, home: '/h' })).toBe(
      resolve('/cfg/projects'),
    );
    expect(resolveTranscriptsRoot({ env: {}, home: '/h' })).toBe(resolve('/h/.claude/projects'));
  });

  it('derives the project folder name the host uses', () => {
    expect(projectTranscriptSlug('/Users/x/my_proj/paqad-ai npm')).toBe(
      '-Users-x-my-proj-paqad-ai-npm',
    );
    expect(projectTranscriptSlug('/Users/x.y/a')).toBe('-Users-x-y-a');
  });

  it('accepts only plain ids', () => {
    expect(isSafeId('01M5DC6C8R1KBH145FZ8HS1VTC')).toBe(true);
    expect(isSafeId(SESSION)).toBe(true);
    for (const bad of ['../x', 'a/b', 'a\\b', '..', '', 'a.b']) {
      expect(isSafeId(bad), bad).toBe(false);
    }
  });

  it('lists the main transcript and each subagent with its type from the meta file', () => {
    const project = speedProject();
    writeTranscript(project, SESSION, [human(0, 'x')]);
    writeTranscript(project, SESSION, [human(0, 'x')], { id: 'a1', agentType: 'paqad-review' });
    mkdirSync(join(project.sessionDir, SESSION, 'subagents'), { recursive: true });
    writeFileSync(join(project.sessionDir, SESSION, 'subagents', 'agent-a2.jsonl'), '');
    writeFileSync(join(project.sessionDir, SESSION, 'subagents', 'notes.txt'), '');
    const sources = sessionTranscripts(project.projectRoot, SESSION, project.transcriptsRoot);
    expect(sources.map((source) => source.agentType)).toEqual([null, 'paqad-review', null]);
    expect(sessionTranscripts(project.projectRoot, 'missing', project.transcriptsRoot)).toEqual([]);
  });

  it('AC-15: reuses recorded transcript paths only inside the transcripts root and never joins an unsafe session id', () => {
    const project = speedProject();
    const inside = writeTranscript(project, SESSION, [human(0, 'x')], {
      id: 'b1',
      agentType: 'paqad-planning',
    });
    const outside = join(project.root, 'elsewhere.jsonl');
    writeFileSync(outside, '');
    const hud = join(project.projectRoot, '.paqad/session/hud');
    mkdirSync(hud, { recursive: true });
    writeFileSync(
      join(hud, `${SESSION}.cost-cache.json`),
      JSON.stringify({
        schema: 'paqad.cost-cache/1',
        session_id: SESSION,
        sources: {
          [inside]: { kind: 'agent', agent_type: 'paqad-checks' },
          [outside]: { kind: 'main', agent_type: null },
        },
      }),
    );
    const sources = sessionTranscripts(project.projectRoot, SESSION, project.transcriptsRoot);
    expect(sources).toEqual([{ path: resolve(inside), agentType: 'paqad-checks' }]);
    expect(sessionTranscripts(project.projectRoot, '../x', project.transcriptsRoot)).toEqual([]);
    expect(sessionTranscripts(project.projectRoot, 'a/b', project.transcriptsRoot)).toEqual([]);
  });
});

describe('ledger changes', () => {
  it('pads the window five minutes, skips rows without recorded_at and drops housekeeping', () => {
    const project = speedProject();
    writeBundle(project, {
      dirName: 'seed-thing-01M5DC6C8R1KBH145FZ8HS1VTC',
      change: '01M5DC6C8R1KBH145FZ8HS1VTC',
      title: 'Seed thing',
      rows: [
        { session: SESSION, at: at(60) },
        { session: 'paqad-housekeeping', at: at(120) },
        { session: '../escape', at: at(90) },
        { doc_type: 'paqad.stage-evidence', session_id: 'old', content_hash: 'h' },
      ],
    });
    const [change] = readLedgerChanges(project.projectRoot);
    expect(change).toMatchObject({
      change: '01M5DC6C8R1KBH145FZ8HS1VTC',
      title: 'Seed thing',
      lane: 'full',
      window: { start: T0 + 60_000 - 300_000, end: T0 + 120_000 + 300_000 },
    });
    expect(change!.sessions).toEqual(['../escape', SESSION]);
  });

  it('gives a bundle without timed rows no window and falls back to the directory name', () => {
    const project = speedProject();
    const dir = join(
      project.projectRoot,
      '.paqad/ledger/feature-evidence/bare-01M5DC6C8R1KBH145FZ8HS1VTC',
    );
    mkdirSync(dir, { recursive: true });
    const [change] = readLedgerChanges(project.projectRoot);
    expect(change).toMatchObject({
      change: '01M5DC6C8R1KBH145FZ8HS1VTC',
      title: 'bare',
      lane: 'unknown',
      window: null,
      sessions: [],
    });
  });

  it('AC-15: refuses a change reference that is not a plain id', () => {
    const project = speedProject();
    writeBundle(project, {
      dirName: '7-seed-thing-01M5DC6C8R1KBH145FZ8HS1VTC',
      change: '01M5DC6C8R1KBH145FZ8HS1VTC',
      title: 'Seed thing',
      rows: [],
    });
    expect(resolveChangeDir(project.projectRoot, '../x')).toBeNull();
    expect(resolveChangeDir(project.projectRoot, '#7')).toBe(
      '7-seed-thing-01M5DC6C8R1KBH145FZ8HS1VTC',
    );
    expect(resolveChangeDir(project.projectRoot, '01M5DC6C8R1KBH145FZ8HS1VTC')).toBe(
      '7-seed-thing-01M5DC6C8R1KBH145FZ8HS1VTC',
    );
    expect(resolveChangeDir(project.projectRoot, 'nothing')).toBeNull();
  });
});

describe('transcript intervals', () => {
  it('AC-3: opens a tool interval at tool_use and closes it at the matching tool_result', () => {
    const built = timeline([
      human(0, 'x'),
      assistant(10, [{ id: 't1', name: 'Bash', input: { command: 'pnpm test' } }]),
      result(40, 't1'),
      assistant(45, [{ id: 't2', name: 'Read', input: { file_path: 'AGENT-ROUTER.md' } }]),
      result(46, 't2'),
      assistant(50, [{ id: 'orphan', name: 'Grep' }]),
    ]);
    expect(built.role).toBe('main');
    expect(built.busy).toEqual([
      { start: T0, end: T0 + 10_000, category: CATEGORY.thinking },
      { start: T0 + 10_000, end: T0 + 40_000, category: CATEGORY.tests },
      { start: T0 + 40_000, end: T0 + 45_000, category: CATEGORY.thinking },
      { start: T0 + 45_000, end: T0 + 46_000, category: CATEGORY.frameworkReread },
      { start: T0 + 46_000, end: T0 + 50_000, category: CATEGORY.thinking },
    ]);
    expect(built.testRuns).toEqual([{ at: T0 + 10_000, kind: 'whole-suite' }]);
  });

  it('AC-6: keeps a tool interval of exactly one hour and drops one a second longer', () => {
    const built = timeline([
      assistant(0, [
        { id: 'a', name: 'Bash', input: { command: 'sleep 1' } },
        { id: 'b', name: 'Bash', input: { command: 'sleep 1' } },
      ]),
      result(3600, 'a'),
      result(3601, 'b'),
    ]);
    const tools = built.busy.filter((span) => span.category === CATEGORY.waiting);
    expect(tools).toEqual([{ start: T0, end: T0 + 3_600_000, category: CATEGORY.waiting }]);
  });

  it('AC-6: counts thinking under fifteen minutes only', () => {
    const built = timeline([human(0, 'x'), assistant(899), human(1000, 'y'), assistant(1900)]);
    const thinking = built.busy.filter((span) => span.category === CATEGORY.thinking);
    expect(thinking).toEqual([{ start: T0, end: T0 + 899_000, category: CATEGORY.thinking }]);
  });

  it('skips Agent tool intervals because the subagent file covers that time', () => {
    const built = timeline([assistant(0, [{ id: 'g', name: 'Agent' }]), result(300, 'g')]);
    expect(built.busy.filter((span) => span.category !== CATEGORY.thinking)).toEqual([]);
  });

  it('AC-5: an Another Claude session sent record is a background wait, not owner time', () => {
    const built = timeline([
      human(0, 'x'),
      assistant(5),
      human(600, 'Another Claude session sent a message:\n<agent-message from="a">hand-back'),
      assistant(610),
    ]);
    expect(built.owner).toEqual([]);
    expect(built.busy).toContainEqual({
      start: T0 + 600_000,
      end: T0 + 610_000,
      category: CATEGORY.thinking,
    });
  });

  it('AC-6: a human gap of exactly thirty minutes is reading and one a second longer is away', () => {
    const built = timeline([assistant(0), human(1800, 'a'), assistant(1801), human(3602, 'b')]);
    expect(built.owner).toEqual([
      { start: T0, end: T0 + 1_800_000, category: OWNER_CATEGORY.reading },
      { start: T0 + 1_801_000, end: T0 + 3_602_000, category: OWNER_CATEGORY.away },
    ]);
  });

  it('AC-3: counts AskUserQuestion as owner time answering questions', () => {
    const built = timeline([
      assistant(0, [{ id: 'q', name: 'AskUserQuestion' }]),
      result(120, 'q'),
    ]);
    expect(built.owner).toEqual([
      { start: T0, end: T0 + 120_000, category: OWNER_CATEGORY.answering },
    ]);
    expect(built.busy).toEqual([]);
  });

  it('AC-14: reduces a refused edit to its label and keeps no hook text', () => {
    const secret = 'SECRET-HOOK-TEXT';
    const built = timeline(
      [
        assistant(0, [
          { id: 'e1', name: 'Edit', input: { file_path: '/p/src/a.ts', new_string: 'a\nb' } },
          { id: 'e2', name: 'Write', input: { file_path: '/p/src/b.ts', content: 'a\nb\nc' } },
          { id: 'e3', name: 'Write', input: { file_path: '/p/.paqad/x.json', content: 'a' } },
          { id: 'e4', name: 'Edit', input: { file_path: '/p/src/c.ts', new_string: 'a' } },
          { id: 'e5', name: 'NotebookEdit', input: { file_path: '/p/n.ipynb' } },
          { id: 'e6', name: 'Edit', input: { file_path: '/p/src/d.ts', new_string: 'a' } },
        ]),
        result(5, 'e1'),
        result(6, 'e2'),
        result(7, 'e3'),
        result(8, 'e4', `PreToolUse:Edit hook error: timed out ${secret}`, true),
        result(
          9,
          'e5',
          [{ type: 'text', text: `hook error agent-entry ${secret}` }] as never,
          true,
        ),
        result(10, 'e6', '<tool_use_error>String not found', true),
      ],
      'paqad-development',
    );
    expect(built.role).toBe('development');
    expect(built.edits).toEqual([
      { start: T0, end: T0 + 5000, refused: null, filePath: '/p/src/a.ts', lines: 2 },
      { start: T0, end: T0 + 6000, refused: null, filePath: '/p/src/b.ts', lines: 3 },
      { start: T0, end: T0 + 7000, refused: null, filePath: null, lines: 0 },
      { start: T0, end: T0 + 8000, refused: CATEGORY.blockedTimeout, filePath: null, lines: 0 },
      { start: T0, end: T0 + 9000, refused: CATEGORY.blockedEntry, filePath: null, lines: 0 },
      { start: T0, end: T0 + 10000, refused: null, filePath: null, lines: 0 },
    ]);
    expect(JSON.stringify(built)).not.toContain(secret);
  });

  it('skips lines that are not JSON or not timed, and counts the bad lines', () => {
    const project = speedProject();
    const path = writeTranscript(project, SESSION, []);
    writeFileSync(
      path,
      [
        'not json',
        JSON.stringify({ type: 'system', timestamp: at(0) }),
        JSON.stringify({ type: 'user', message: { content: 'x' } }),
        JSON.stringify(human(1, 'x')),
        JSON.stringify(assistant(2)),
      ].join('\n'),
    );
    const built = readTranscriptTimeline({ path, agentType: null });
    expect(built?.badLines).toBe(1);
    expect(built?.busy).toEqual([
      { start: T0 + 1000, end: T0 + 2000, category: CATEGORY.thinking },
    ]);
  });

  it('reports an unreadable transcript as missing', () => {
    expect(readTranscriptTimeline({ path: '/nope/none.jsonl', agentType: null })).toBeNull();
  });
});

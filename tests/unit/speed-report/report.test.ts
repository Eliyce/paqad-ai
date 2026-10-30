import { describe, expect, it, vi } from 'vitest';

import { createReportCommand } from '@/cli/commands/report.js';

import { CATEGORY } from '@/speed-report/classify.js';
import {
  NO_TRANSCRIPT,
  SpeedReportInputError,
  buildSpeedReport,
  formatSpan,
  parseSinceDate,
  renderSpeedReport,
  splitOwnership,
  type MeasuredChange,
} from '@/speed-report/report.js';

import {
  T0,
  assistant,
  at,
  human,
  result,
  speedProject,
  writeBundle,
  writeTranscript,
  type SpeedProject,
} from './speed-fixtures.js';

const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';
const CHANGE = '01M5DC6C8R1KBH145FZ8HS1VTC';
const DIR = `seed-thing-${CHANGE}`;

function project(): SpeedProject {
  const p = speedProject();
  writeBundle(p, {
    dirName: DIR,
    change: CHANGE,
    title: 'Seed thing',
    rows: [
      { session: SESSION, at: at(300) },
      { session: SESSION, at: at(3000) },
    ],
  });
  writeTranscript(p, SESSION, [
    human(0, 'start'),
    assistant(10, [{ id: 'm1', name: 'Bash', input: { command: 'git status' } }]),
    result(20, 'm1'),
    assistant(25, [{ id: 'q1', name: 'AskUserQuestion' }]),
    result(85, 'q1'),
    assistant(90),
    human(400, 'Another Claude session sent a message: done'),
    assistant(405),
  ]);
  writeTranscript(
    p,
    SESSION,
    [
      human(100, 'brief'),
      assistant(110, [
        { id: 'd1', name: 'Edit', input: { file_path: '/p/src/a.ts', new_string: 'a\nb' } },
      ]),
      result(115, 'd1'),
      assistant(120, [{ id: 'd2', name: 'Edit', input: { file_path: '/p/src/a.ts' } }]),
      result(130, 'd2', 'PreToolUse:Edit hook error: timed out', true),
      assistant(135, [{ id: 'd3', name: 'Bash', input: { command: 'pnpm vitest run tests/a' } }]),
      result(200, 'd3'),
      assistant(205, [{ id: 'd4', name: 'Bash', input: { command: 'paqad-ai checks run' } }]),
      result(300, 'd4'),
    ],
    { id: 'dev1', agentType: 'paqad-development' },
  );
  writeTranscript(
    p,
    SESSION,
    [
      human(150, 'brief'),
      assistant(160, [{ id: 'r1', name: 'Read', input: { file_path: '/p/src/a.ts' } }]),
      result(400, 'r1'),
    ],
    { id: 'rev1', agentType: 'paqad-review' },
  );
  return p;
}

function measured(p: SpeedProject): MeasuredChange {
  const report = buildSpeedReport({
    projectRoot: p.projectRoot,
    transcriptsRoot: p.transcriptsRoot,
  });
  const row = report.changes[0];
  if (!row || row.status === NO_TRANSCRIPT) throw new Error('not measured');
  return row;
}

describe('speed report aggregation', () => {
  it('AC-10: measures busy time, size, owner wait, the edit gate and test runs per change', () => {
    const row = measured(project());
    expect(row).toMatchObject({
      change: CHANGE,
      title: 'Seed thing',
      lane: 'full',
      status: 'measured',
      size: { files: 1, lines: 2 },
      busy_ms: 335_000,
      owner_wait_ms: 60_000,
      edit_gate: {
        edits: 2,
        median_ms: 7500,
        p90_ms: 10_000,
        refused: {
          [CATEGORY.blockedTimeout]: 1,
          [CATEGORY.blockedEntry]: 0,
          [CATEGORY.blockedOther]: 0,
        },
      },
      test_runs: { whole_suite: 1, targeted: 1, reused: 0 },
    });
    expect(row.development_ms + row.ceremony_ms + row.orchestrator_ms + row.other_agents_ms).toBe(
      row.busy_ms,
    );
    expect(row.categories[CATEGORY.tests]).toBe(65_000);
    expect(row.owner_wait['answering questions']).toBe(60_000);
  });

  it('counts a checks run that reused the green test run apart from real whole-suite and targeted runs', async () => {
    const p = project();
    writeTranscript(
      p,
      SESSION,
      [
        human(500, 'brief'),
        assistant(510, [{ id: 'c1', name: 'Bash', input: { command: 'paqad-ai checks run' } }]),
        result(
          520,
          'c1',
          '**▸ paqad** · checks green (2 s)\n> - 🟢 reused green test run from 10:05 (same files, same command): 12 tests',
        ),
        assistant(530, [{ id: 'c2', name: 'Bash', input: { command: 'paqad-ai checks run' } }]),
        result(540, 'c2', '> - 🟢 reused green build run from 10:05 (same files, same command)'),
      ],
      { id: 'chk1', agentType: 'paqad-checks' },
    );
    const row = measured(p);
    expect(row.test_runs).toEqual({ whole_suite: 2, targeted: 1, reused: 1 });
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
    await createReportCommand().parseAsync(
      ['speed', '--json', '--project-root', p.projectRoot, '--transcripts-root', p.transcriptsRoot],
      { from: 'user' },
    );
    vi.restoreAllMocks();
    const json = JSON.parse(out.join('\n')) as { changes: Array<{ test_runs: unknown }> };
    expect(json.changes[0]?.test_runs).toEqual({ whole_suite: 2, targeted: 1, reused: 1 });
    expect(
      renderSpeedReport(
        buildSpeedReport({ projectRoot: p.projectRoot, transcriptsRoot: p.transcriptsRoot }),
      ),
    ).toMatch(/ 2\/1\/1\n/);
  });

  it('AC-7: gives each ten-second bucket to the first active agent in the fixed order', () => {
    const window = { start: T0, end: T0 + 40_000 };
    const owned = splitOwnership(
      [
        { start: T0, end: T0 + 40_000 },
        { start: T0 + 5000, end: T0 + 25_000 },
        { start: T0 + 12_000, end: T0 + 15_000 },
      ],
      new Map([
        ['main', [{ start: T0, end: T0 + 40_000 }]],
        ['review', [{ start: T0 + 5000, end: T0 + 25_000 }]],
        ['development', [{ start: T0 + 12_000, end: T0 + 15_000 }]],
      ]),
      window,
    );
    expect(owned).toEqual({
      development: 10_000,
      ceremony: 20_000,
      orchestrator: 10_000,
      other: 0,
    });
  });

  it('AC-6: a ledger row exactly five minutes inside the padding still counts its interval', () => {
    const p = speedProject();
    writeBundle(p, {
      dirName: DIR,
      change: CHANGE,
      title: 'Edge',
      rows: [{ session: SESSION, at: at(600) }],
    });
    writeTranscript(p, SESSION, [
      assistant(300, [{ id: 'in', name: 'Bash', input: { command: 'pnpm test' } }]),
      result(301, 'in'),
      assistant(299, [{ id: 'out', name: 'Bash', input: { command: 'pnpm test' } }]),
      result(299.5, 'out'),
    ]);
    const row = measured(p);
    expect(row.window_start_ms).toBe(T0 + 300_000);
    expect(row.test_runs.whole_suite).toBe(1);
    expect(row.categories[CATEGORY.tests]).toBe(1000);
  });

  it('AC-11: a project with no transcripts prints no transcript rows left out of the totals', () => {
    const p = speedProject();
    writeBundle(p, {
      dirName: DIR,
      change: CHANGE,
      title: 'Lonely',
      rows: [{ session: SESSION, at: at(0) }],
    });
    writeBundle(p, {
      dirName: `bad-session-01M5XRN9CWF9RDTNFC1A21A0SV`,
      change: '01M5XRN9CWF9RDTNFC1A21A0SV',
      title: 'Escaping',
      rows: [{ session: '../../etc', at: at(0) }],
    });
    const report = buildSpeedReport({
      projectRoot: p.projectRoot,
      transcriptsRoot: p.transcriptsRoot,
    });
    expect(report.changes.map((row) => row.status)).toEqual([NO_TRANSCRIPT, NO_TRANSCRIPT]);
    expect(report.totals).toEqual([]);
    expect(report.top_categories).toEqual([]);
    const text = renderSpeedReport(report);
    expect(text).toContain('0 change(s) with transcripts, 2 without');
    expect(text).toMatch(/Lonely\s+full\s+no transcript/);
  });

  it('AC-10: renders one row per bundle, a totals block per lane and the top five categories', () => {
    const p = project();
    writeBundle(p, {
      dirName: `other-01M5XRN9CWF9RDTNFC1A21A0SV`,
      change: '01M5XRN9CWF9RDTNFC1A21A0SV',
      title: 'Graduated change',
      lane: 'graduated',
      rows: [{ session: SESSION, at: at(200) }],
    });
    const report = buildSpeedReport({
      projectRoot: p.projectRoot,
      transcriptsRoot: p.transcriptsRoot,
    });
    expect(report.changes).toHaveLength(2);
    expect(report.totals.map((totals) => totals.lane)).toEqual(['full', 'graduated']);
    expect(report.top_categories.length).toBeLessThanOrEqual(5);
    const text = renderSpeedReport(report);
    expect(text).toContain('paqad speed report  (2 change(s) with transcripts, 0 without)');
    expect(text).toContain('Totals (full): 1 change(s)');
    expect(text).toContain('Totals (graduated): 1 change(s)');
    expect(text).toContain('Edit gate (full): median 7.5s, p90 10s, 1 refused on timeout');
    expect(text).toContain('Test runs (full): 1 whole-suite, 1 targeted, 0 reused');
    expect(text).toContain('tests w/t/r');
    expect(text).toContain('Top busy categories: ');
  });

  it('AC-9: applies --since in UTC whatever the local time zone', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        const p = project();
        const keep = buildSpeedReport({
          projectRoot: p.projectRoot,
          transcriptsRoot: p.transcriptsRoot,
          since: '2026-10-20',
        });
        const drop = buildSpeedReport({
          projectRoot: p.projectRoot,
          transcriptsRoot: p.transcriptsRoot,
          since: '2026-10-20T10:01',
        });
        expect(keep.changes, zone).toHaveLength(1);
        expect(drop.changes, zone).toHaveLength(0);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
    expect(parseSinceDate('2026-10-20T10:00:00+02:00')).toBe(Date.parse('2026-10-20T08:00:00Z'));
  });

  it('AC-12: names an unreadable --since date and an unknown --change id', () => {
    const p = project();
    expect(() => parseSinceDate('yesterday')).toThrow(SpeedReportInputError);
    expect(() => parseSinceDate('2026-13-45')).toThrow(
      '--since is not a readable date: 2026-13-45',
    );
    expect(() =>
      buildSpeedReport({
        projectRoot: p.projectRoot,
        transcriptsRoot: p.transcriptsRoot,
        change: 'nope',
      }),
    ).toThrow('no change matches --change nope');
    expect(() =>
      buildSpeedReport({
        projectRoot: p.projectRoot,
        transcriptsRoot: p.transcriptsRoot,
        change: '../x',
      }),
    ).toThrow(SpeedReportInputError);
  });

  it('selects one change with --change', () => {
    const p = project();
    const report = buildSpeedReport({
      projectRoot: p.projectRoot,
      transcriptsRoot: p.transcriptsRoot,
      change: CHANGE,
    });
    expect(report.changes.map((row) => row.change)).toEqual([CHANGE]);
  });

  it('formats spans in seconds, minutes and hours', () => {
    expect(formatSpan(9400)).toBe('9.4s');
    expect(formatSpan(18_100)).toBe('18s');
    expect(formatSpan(65 * 60_000)).toBe('65m');
    expect(formatSpan(179 * 60_000)).toBe('179m');
    expect(formatSpan(3.5 * 3_600_000)).toBe('3.5h');
  });
});

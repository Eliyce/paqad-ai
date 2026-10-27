import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const watched = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const wrap =
    <T extends (...args: never[]) => unknown>(name: string, fn: T) =>
    (...args: Parameters<T>) => {
      watched.calls.push(name);
      return fn(...args);
    };
  return {
    ...actual,
    spawn: wrap('spawn', actual.spawn),
    spawnSync: wrap('spawnSync', actual.spawnSync),
    exec: wrap('exec', actual.exec),
    execSync: wrap('execSync', actual.execSync),
    execFile: wrap('execFile', actual.execFile),
    execFileSync: wrap('execFileSync', actual.execFileSync),
    fork: wrap('fork', actual.fork),
  };
});

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  return {
    ...actual,
    connect: (...args: Parameters<typeof actual.connect>) => {
      watched.calls.push('net.connect');
      return actual.connect(...args);
    },
    createConnection: (...args: Parameters<typeof actual.createConnection>) => {
      watched.calls.push('net.createConnection');
      return actual.createConnection(...args);
    },
  };
});

import { createReportCommand } from '@/cli/commands/report.js';
import { CATEGORY, OWNER_CATEGORY } from '@/speed-report/classify.js';
import { MEASURED, NO_TRANSCRIPT, SPEED_REPORT_SCHEMA } from '@/speed-report/report.js';

import {
  assistant,
  at,
  human,
  result,
  speedProject,
  writeBundle,
  writeTranscript,
  type SpeedProject,
} from '../speed-report/speed-fixtures.js';

const SENTINEL = 'SENTINEL-c0ffee-private-text';
const SESSION = 'bbbbbbbb-1111-2222-3333-444444444444';
const CHANGE = '01M5DC6C8R1KBH145FZ8HS1VTC';

function seeded(): SpeedProject {
  const p = speedProject();
  writeBundle(p, {
    dirName: `seed-thing-${CHANGE}`,
    change: CHANGE,
    title: 'Seed thing',
    rows: [
      { session: SESSION, at: at(0) },
      { session: SESSION, at: at(600) },
    ],
  });
  writeTranscript(p, SESSION, [
    human(0, `please build ${SENTINEL}`),
    assistant(5, [
      { id: 'b1', name: 'Bash', input: { command: `echo ${SENTINEL} && pnpm test` } },
      { id: 'r1', name: 'Read', input: { file_path: `/p/${SENTINEL}.ts` } },
      { id: 'e1', name: 'Edit', input: { file_path: '/p/src/a.ts', new_string: SENTINEL } },
      { id: 'e2', name: 'Edit', input: { file_path: '/p/src/b.ts', new_string: 'x' } },
    ]),
    result(9, 'b1', `output ${SENTINEL}`),
    result(10, 'r1', SENTINEL),
    result(11, 'e1'),
    result(12, 'e2', `PreToolUse:Edit hook error: ${SENTINEL} timed out`, true),
    assistant(20),
    human(100, `<task-notification> ${SENTINEL}`),
  ]);
  return p;
}

interface Run {
  out: string;
  err: string;
  exitCode: number | undefined;
}

async function run(args: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line?: unknown) => err.push(String(line)));
  process.exitCode = undefined;
  await createReportCommand().parseAsync(['speed', ...args], { from: 'user' });
  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined;
  process.exitCode = undefined;
  return { out: out.join('\n'), err: err.join('\n'), exitCode };
}

function treeDigest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        hash.update(`d:${path}\n`);
        walk(path);
      } else {
        hash.update(`f:${path}\n`);
        hash.update(readFileSync(path));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const ALLOWED_STRINGS = new Set<string>([
  SPEED_REPORT_SCHEMA,
  MEASURED,
  NO_TRANSCRIPT,
  CHANGE,
  'Seed thing',
  'full',
  ...Object.values(CATEGORY),
  ...Object.values(OWNER_CATEGORY),
]);

function leafStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) leafStrings(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) leafStrings(item, out);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  watched.calls.length = 0;
});

describe('paqad-ai report speed', () => {
  it('AC-10: prints one row per bundle, the lane totals and the top categories, exit 0', async () => {
    const p = seeded();
    const { out, exitCode } = await run([
      '--project-root',
      p.projectRoot,
      '--transcripts-root',
      p.transcriptsRoot,
    ]);
    expect(exitCode).toBeUndefined();
    expect(out).toContain('paqad speed report  (1 change(s) with transcripts, 0 without)');
    expect(out).toMatch(/Seed thing\s+full/);
    expect(out).toContain('Totals (full): 1 change(s)');
    expect(out).toContain('Top busy categories: ');
  });

  it('AC-11: a project with no transcripts prints no transcript and exits 0', async () => {
    const p = seeded();
    const { out, exitCode } = await run([
      '--project-root',
      p.projectRoot,
      '--transcripts-root',
      join(p.root, 'empty'),
    ]);
    expect(exitCode).toBeUndefined();
    expect(out).toMatch(/Seed thing\s+full\s+no transcript/);
    expect(out).not.toContain('Totals');
  });

  it('AC-11: reads transcripts from CLAUDE_CONFIG_DIR when no root is passed', async () => {
    const p = seeded();
    vi.stubEnv('CLAUDE_CONFIG_DIR', p.root);
    try {
      const { out } = await run(['--project-root', p.projectRoot, '--json']);
      const parsed = JSON.parse(out) as { changes: Array<{ status: string }> };
      expect(parsed.changes[0]?.status).toBe(MEASURED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC-12: an unknown --change id or an unreadable --since date is one error line and a non-zero exit', async () => {
    const p = seeded();
    const base = ['--project-root', p.projectRoot, '--transcripts-root', p.transcriptsRoot];
    const unknown = await run([...base, '--change', 'nothing-like-it']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.out).toBe('');
    expect(unknown.err).toBe('paqad: no change matches --change nothing-like-it');
    const since = await run([...base, '--since', 'last tuesday']);
    expect(since.exitCode).toBe(1);
    expect(since.out).toBe('');
    expect(since.err).toBe('paqad: --since is not a readable date: last tuesday');
  });

  it('AC-15: a --change of ../x opens nothing and fails', async () => {
    const p = seeded();
    const { exitCode, out } = await run([
      '--project-root',
      p.projectRoot,
      '--transcripts-root',
      p.transcriptsRoot,
      '--change',
      '../x',
    ]);
    expect(exitCode).toBe(1);
    expect(out).toBe('');
  });

  it('AC-13: private prompt, command and tool text never reaches stdout or stderr', async () => {
    const p = seeded();
    const base = ['--project-root', p.projectRoot, '--transcripts-root', p.transcriptsRoot];
    for (const extra of [[], ['--json']]) {
      const { out, err } = await run([...base, ...extra]);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain(SENTINEL);
      expect(err).not.toContain(SENTINEL);
    }
  });

  it('AC-14: every JSON value is a number, a category, a change id, a lane or a title', async () => {
    const p = seeded();
    const { out } = await run([
      '--project-root',
      p.projectRoot,
      '--transcripts-root',
      p.transcriptsRoot,
      '--json',
    ]);
    const parsed = JSON.parse(out) as {
      changes: Array<{ categories: Record<string, number>; edit_gate: { refused: object } }>;
    };
    for (const value of leafStrings(parsed)) {
      expect(ALLOWED_STRINGS.has(value), value).toBe(true);
    }
    const categories = new Set<string>(Object.values(CATEGORY));
    for (const key of Object.keys(parsed.changes[0]!.categories)) {
      expect(categories.has(key), key).toBe(true);
    }
    expect(Object.keys(parsed.changes[0]!.edit_gate.refused)).toEqual([
      CATEGORY.blockedTimeout,
      CATEGORY.blockedEntry,
      CATEGORY.blockedOther,
    ]);
    expect(out).not.toContain('hook error');
  });

  it('AC-16: leaves the .paqad tree byte-identical and spawns no process or connection', async () => {
    const p = seeded();
    const hud = join(p.projectRoot, '.paqad/session/hud');
    mkdirSync(hud, { recursive: true });
    writeFileSync(join(hud, `${SESSION}.cost-cache.json`), '{"schema":"other"}');
    const paqadBefore = treeDigest(join(p.projectRoot, '.paqad'));
    const transcriptsBefore = treeDigest(p.transcriptsRoot);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const extra of [[], ['--json'], ['--change', CHANGE]]) {
      await run([
        '--project-root',
        p.projectRoot,
        '--transcripts-root',
        p.transcriptsRoot,
        ...extra,
      ]);
    }
    expect(treeDigest(join(p.projectRoot, '.paqad'))).toBe(paqadBefore);
    expect(treeDigest(p.transcriptsRoot)).toBe(transcriptsBefore);
    expect(watched.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says so and builds nothing when paqad is disabled', async () => {
    const p = seeded();
    mkdirSync(join(p.projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(p.projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    const { out, err, exitCode } = await run([
      '--project-root',
      p.projectRoot,
      '--transcripts-root',
      p.transcriptsRoot,
    ]);
    expect(out).toBe('');
    expect(err).toContain('paqad is disabled');
    expect(exitCode).toBeUndefined();
  });
});

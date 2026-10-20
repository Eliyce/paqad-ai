import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebtCommand } from '@/cli/commands/debt.js';
import { createProgram } from '@/cli/program.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { readFeatureTechDebtIndex } from '@/feature-evidence/tech-debt-index.js';
import { readDebtItem } from '@/tech-debt/index.js';

describe('paqad-ai debt command', () => {
  let root: string;
  const SES = 'ses_cli_debt';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-debt-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<{ lines: string[]; errors: string[] }> {
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await createDebtCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return { lines, errors };
  }

  async function add(...extra: string[]): Promise<{ id: string; outcome: string; path: string }> {
    const { lines } = await run(
      'add',
      '--title',
      'Stale cache hides edits',
      '--kind',
      'bug',
      '--severity',
      'medium',
      '--file',
      'src/b.ts',
      '--file',
      'src/a.ts',
      ...extra,
    );
    return JSON.parse(lines.at(-1)!) as { id: string; outcome: string; path: string };
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('debt');
  });

  it('records an item with no active change and the default finder', async () => {
    const first = await add();
    expect(first.outcome).toBe('created');
    expect(first.path).toBe(`docs/instructions/tech-debt/${first.id}.md`);
    expect(readDebtItem(root, first.id)).toMatchObject({
      files: ['src/a.ts', 'src/b.ts'],
      found_by: 'orchestrator',
      found_in: { change: null, issue: null, stage: null },
      session: SES,
    });
  });

  it('links the active change, its issue and the running stage, and honours --agent', async () => {
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      lane: 'full',
      issue: '42',
      title: 'Some change',
    });
    startStage(root, 'review', { sessionId: SES, dirName: dir, adapter: 'claude-code' });
    writeFileSync(join(root, 'body.md'), 'The details.\n');
    const result = await add('--agent', 'paqad-review', '--body-file', 'body.md');
    expect(readFeatureTechDebtIndex(root, dir)?.map((entry) => entry.id)).toEqual([result.id]);
    expect(readDebtItem(root, result.id)).toMatchObject({
      found_by: 'paqad-review',
      found_in: { change: featureChangeKey(dir), issue: '42', stage: 'review' },
      body: 'The details.',
    });
  });

  it('prints the existing id and writes nothing on a duplicate', async () => {
    const first = await add();
    const { lines } = await run(
      'add',
      '--title',
      '  STALE cache   hides edits',
      '--kind',
      'bug',
      '--severity',
      'medium',
      '--file',
      'src/a.ts',
      '--file',
      './src/b.ts',
    );
    expect(lines[0]).toContain('nothing written');
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ id: first.id, outcome: 'existing' });
    expect(
      readdirSync(join(root, 'docs/instructions/tech-debt')).filter((f) => f.startsWith('TD-')),
    ).toHaveLength(1);
  });

  it('reopens a closed item and says so', async () => {
    const first = await add();
    await run('close', first.id, '--reason', 'fixed');
    const { lines } = await run(
      'add',
      '--title',
      'Stale cache hides edits',
      '--kind',
      'bug',
      '--severity',
      'medium',
      '--file',
      'src/a.ts',
      '--file',
      'src/b.ts',
    );
    expect(lines[0]).toContain('reopened');
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ id: first.id, outcome: 'reopened' });
  });

  it('refuses a bad kind or a file outside the project with exit 1', async () => {
    const bad = await run('add', '--title', 'x', '--kind', 'nope', '--severity', 'low');
    expect(bad.errors.join('\n')).toContain('--kind must be one of');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    const outside = await run(
      'add',
      '--title',
      'x',
      '--kind',
      'bug',
      '--severity',
      'low',
      '--file',
      '../elsewhere.ts',
    );
    expect(outside.errors.join('\n')).toContain('outside the project root');
    expect(process.exitCode).toBe(1);
  });

  it('promotes and closes an item, and refuses an id that is not TD-<ULID>', async () => {
    const first = await add();
    const promoted = await run('promote', first.id, '--issue', 'PQD-7');
    expect(JSON.parse(promoted.lines.at(-1)!)).toEqual({
      id: first.id,
      status: 'promoted',
      issue: 'PQD-7',
    });
    const closed = await run('close', first.id, '--reason', 'done');
    expect(JSON.parse(closed.lines.at(-1)!)).toEqual({
      id: first.id,
      status: 'closed',
      closed_reason: 'done',
    });
    const bad = await run('close', '../../x', '--reason', 'r');
    expect(bad.errors.join('\n')).toContain('not a tech-debt id');
    expect(process.exitCode).toBe(1);
  });

  it('lists items as text or json and filters by status and change', async () => {
    const empty = await run('list');
    expect(empty.lines).toEqual(['No tech-debt items match.']);

    const first = await add();
    const text = await run('list');
    expect(text.lines).toEqual([`${first.id}  open  (bug, medium)  Stale cache hides edits`]);

    const json = await run('list', '--format', 'json', '--status', 'all');
    expect((JSON.parse(json.lines[0]!) as { id: string }[]).map((item) => item.id)).toEqual([
      first.id,
    ]);

    const byChange = await run('list', '--change', '01M5CCWX6FTKY8C6EJKMR9EH3D');
    expect(byChange.lines).toEqual(['No tech-debt items match.']);
  });

  it('resolves --change current to the active change and fails with none', async () => {
    const none = await run('list', '--change', 'current');
    expect(none.errors.join('\n')).toContain('no active change');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;

    openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'full' });
    const first = await add();
    const current = await run('list', '--change', 'current', '--format', 'json');
    expect((JSON.parse(current.lines[0]!) as { id: string }[]).map((item) => item.id)).toEqual([
      first.id,
    ]);
  });

  it('rejects an unknown status or format', async () => {
    const status = await run('list', '--status', 'weird');
    expect(status.errors.join('\n')).toContain('--status must be one of');
    process.exitCode = undefined;
    const format = await run('list', '--format', 'xml');
    expect(format.errors.join('\n')).toContain('--format must be one of');
    expect(process.exitCode).toBe(1);
  });

  async function addWithoutSessionFlag(title: string): Promise<string | null> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    await createDebtCommand().parseAsync(
      ['add', '--title', title, '--kind', 'gap', '--severity', 'low', '--project-root', root],
      { from: 'user' },
    );
    const { id } = JSON.parse(lines.at(-1)!) as { id: string };
    return readDebtItem(root, id).session;
  }

  it('falls back to SE_SESSION, then CLAUDE_SESSION_ID, when --session is not given', async () => {
    vi.stubEnv('SE_SESSION', 'ses_from_env');
    expect(await addWithoutSessionFlag('first')).toBe('ses_from_env');
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', 'ses_from_claude');
    expect(await addWithoutSessionFlag('second')).toBe('ses_from_claude');
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    expect(await addWithoutSessionFlag('third')).toBe('ses_from_claude');
  });
});

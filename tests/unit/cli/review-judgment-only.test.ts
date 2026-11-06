import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReviewCommand } from '@/cli/commands/review.js';
import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

import { commitAll, git, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';

const machineRows = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('@/review-digest/sources.js', async (original) => ({
  ...(await original<typeof import('@/review-digest/sources.js')>()),
  collectMachineFindings: () => machineRows.rows,
}));

const SES = 'ses_review_judgment';

describe('review record against machine findings', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('SE_AGENT_ID', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    root = mkdtempSync(join(tmpdir(), 'paqad-review-judgment-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    out = [];
    err = [];
    machineRows.rows = [
      { tier: 'deterministic', file: 'src/a.ts', source: 'rule-script' },
      { tier: 'advisory', file: 'src/ignored.ts', source: 'ignored-source' },
    ];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  const open = (started = true) => {
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Judgment',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXY90',
      lane: 'fast',
    });
    if (started) appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'review' });
    return dir;
  };

  const record = async (findings: unknown, extraFlags: string[] = []) => {
    const input = join(root, 'review.input.json');
    writeFileSync(
      input,
      JSON.stringify({
        summary: 'Read the diff for regressions.',
        verdict: 'needs-attention',
        checked: ['correctness'],
        rollback: 'Revert.',
        findings,
      }),
    );
    await createReviewCommand().parseAsync(
      ['record', input, '--project-root', root, ...extraFlags],
      { from: 'user' },
    );
  };
  const session = ['--session', SES];
  const JUDGMENT = 'every finding is judgment';

  it.each([
    ['its file', { severity: 'minor', description: 'naming', file: 'src/a.ts' }],
    ['a description naming the file', { severity: 'minor', description: 'see src/a.ts line 3' }],
    ['a description naming the source', { severity: 'minor', description: 'from rule-script' }],
  ])('accepts a finding that cites a machine row by %s', async (_name, finding) => {
    open();
    await record([finding], session);
    expect(err.join('\n')).not.toContain(JUDGMENT);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ recorded: true });
  });

  it('refuses findings that cite no machine row, and records nothing', async () => {
    open();
    await record([{ severity: 'minor', description: 'naming', file: 'src/other.ts' }], session);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain(JUDGMENT);
    expect(out).toEqual([]);
  });

  it('refuses a finding with no description against a row that names no file', async () => {
    machineRows.rows = [{ tier: 'deterministic', file: null, source: 'gate' }];
    open();
    await record([{ severity: 'minor', file: 'src/other.ts' }], session);
    expect(err.join('\n')).toContain(JUDGMENT);
  });

  it('lets a review with no findings through', async () => {
    open();
    await record([], session);
    expect(err.join('\n')).not.toContain(JUDGMENT);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ recorded: true });
  });

  it('lets a template whose findings are not a list reach the writer', async () => {
    open();
    await record('not a list', session);
    expect(err.join('\n')).not.toContain(JUDGMENT);
  });

  it('asks for nothing when the digest has only advisory rows', async () => {
    machineRows.rows = [{ tier: 'advisory', file: 'src/a.ts', source: 'x' }];
    open();
    await record([{ severity: 'minor', description: 'naming', file: 'src/b.ts' }], session);
    expect(err.join('\n')).not.toContain(JUDGMENT);
  });

  it('asks for nothing on a stage that has no chained start row', async () => {
    open(false);
    await record([{ severity: 'minor', description: 'naming', file: 'src/b.ts' }], session);
    expect(err.join('\n')).not.toContain(JUDGMENT);
  });

  it('says no change is active rather than judging one', async () => {
    await record([{ severity: 'minor', description: 'naming', file: 'src/b.ts' }], session);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).not.toContain(JUDGMENT);
    expect(out).toEqual([]);
  });

  it('takes the session from SE_SESSION, then CLAUDE_SESSION_ID', async () => {
    open();
    vi.stubEnv('SE_SESSION', SES);
    await record([], []);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ recorded: true });
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', SES);
    await record([], []);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ recorded: true });
  });

  describe('review digest', () => {
    const digest = (flags: string[]) =>
      createReviewCommand().parseAsync(['digest', '--project-root', root, ...flags], {
        from: 'user',
      });

    it('writes the digest and prints where it went', async () => {
      open();
      machineRows.rows = [];
      await digest(session);
      const printed = JSON.parse(out.at(-1)!) as { written: boolean; path: string };
      expect(printed.written).toBe(true);
      expect(out[0]).toContain(printed.path);
    });

    it('fails plainly when the project folder cannot hold a digest', async () => {
      rmSync(join(root, '.paqad'), { recursive: true, force: true });
      writeFileSync(join(root, '.paqad'), 'not a folder');
      await digest(session);
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('could not write the review digest');
    });

    it.each(['SE_SESSION', 'CLAUDE_SESSION_ID'])('takes the session from %s', async (name) => {
      open();
      machineRows.rows = [];
      vi.stubEnv(name, SES);
      await digest([]);
      expect(JSON.parse(out.at(-1)!)).toMatchObject({ written: true });
    });
  });

  describe('on a change with its own files', () => {
    const judgment = { severity: 'minor', description: 'naming' };

    function ownRepo(): void {
      rmSync(root, { recursive: true, force: true });
      root = makeEmptyRepo('main');
      writeRepoFile(root, 'src/a.ts', 'export const a = 1;\n');
      writeRepoFile(root, 'src/b.ts', 'export const b = 1;\n');
      commitAll(root, 'chore: base');
      git(root, ['switch', '-q', '-c', 'feat/own']);
      open();
      writeRepoFile(root, 'src/b.ts', 'export const b = 2;\n');
    }

    it('AC-21: review record does not demand a citation of a row on another file', async () => {
      ownRepo();
      machineRows.rows = [{ tier: 'deterministic', file: 'src/a.ts', source: 'rule:RL-1' }];
      await record([judgment], session);
      expect(err.join('\n')).not.toContain(JUDGMENT);
    });

    it('AC-21: review record still demands a citation of a row on its own file', async () => {
      ownRepo();
      machineRows.rows = [{ tier: 'deterministic', file: 'src/b.ts', source: 'rule:RL-1' }];
      await record([judgment], session);
      expect(err.join('\n')).toContain(JUDGMENT);
    });

    it('AC-22: a checks row on an untouched test keeps the citation requirement', async () => {
      ownRepo();
      machineRows.rows = [{ tier: 'deterministic', file: 'tests/a.test.ts', source: 'checks:v' }];
      await record([judgment], session);
      expect(err.join('\n')).toContain(JUDGMENT);
    });
  });
});

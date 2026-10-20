import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFixCommand } from '@/cli/commands/fix.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readFixProofRows } from '@/fix-protocol/fix-proof-record.js';

const SES = 'ses-fix-cli';

describe('paqad-ai fix prove', () => {
  let root: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fix-cli-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(line));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    await createFixCommand().parseAsync(
      ['prove', ...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
  }

  const proofArgs = (command: string, ...extra: string[]) => [
    '--test-file',
    'tests/a.test.ts',
    '--test-id',
    'a > works',
    '--command',
    command,
    ...extra,
  ];

  it('records a red run that passed as not reproduced', async () => {
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
    await run('red', ...proofArgs('node --version'));
    expect(process.exitCode).toBeUndefined();
    expect(readFixProofRows(root, dir).map((row) => row.outcome)).toEqual(['not-reproduced']);
    expect(logs.join('\n')).toContain('not reproduced');
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ recorded: true, outcome: 'not-reproduced' });
  });

  it('exits 1 on a proof command that cannot run and keeps the summary off with --silent', async () => {
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
    await run('red', ...proofArgs('paqad-no-such-binary-xyz', '--silent'));
    expect(process.exitCode).toBe(1);
    expect(readFixProofRows(root, dir)[0]?.outcome).toBe('error');
    expect(logs.some((line) => line.startsWith('{'))).toBe(false);
  });

  it.each([
    ['SE_SESSION', SES],
    ['CLAUDE_SESSION_ID', SES],
  ])('reads the session from %s when --session is absent', async (name, value) => {
    vi.stubEnv('SE_SESSION', '');
    vi.stubEnv('CLAUDE_SESSION_ID', '');
    vi.stubEnv(name, value);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
    await createFixCommand().parseAsync(
      ['prove', 'red', ...proofArgs('node --version'), '--project-root', root],
      { from: 'user' },
    );
    expect(readFixProofRows(root, dir)).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('refuses an unknown phase, a bad timeout and a missing change', async () => {
    await run('blue', ...proofArgs('node --version'));
    expect(errors.at(-1)).toContain('unknown phase');
    process.exitCode = undefined;
    await run('red', ...proofArgs('node --version', '--timeout', 'soon'));
    expect(errors.at(-1)).toContain('--timeout');
    process.exitCode = undefined;
    await run('green', ...proofArgs('node --version', '--timeout', '5'));
    expect(errors.at(-1)).toContain('no active feature');
    expect(process.exitCode).toBe(1);
  });
});

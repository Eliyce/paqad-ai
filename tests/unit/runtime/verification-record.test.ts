import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../../../runtime/hooks/verification-record.mjs');

function run(
  projectRoot: string,
  payload: unknown,
  { adapter, env = {} }: { adapter?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string } {
  const args = adapter ? [HOOK, adapter] : [HOOK];
  try {
    const stdout = execFileSync('node', args, {
      input: JSON.stringify(payload),
      env: { ...process.env, PAQAD_PROJECT_ROOT: projectRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString(), stderr: '' };
  } catch (error) {
    const e = error as { status: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

describe('runtime/hooks/verification-record.mjs (record-only contract)', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-record-hook-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('exits 0 and stays silent when disabled', () => {
    const r = run(
      projectRoot,
      { session_id: 's', prompt_response: 'paqad:stage planning start' },
      { adapter: 'gemini-cli', env: { PAQAD_DISABLED: '1' } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('exits 0 on an empty / non-JSON payload', () => {
    expect(run(projectRoot, '', { adapter: 'codex-cli' }).status).toBe(0);
  });

  it('exits 0 with a Codex Stop payload whose transcript_path is unreadable', () => {
    expect(
      run(
        projectRoot,
        { session_id: 's', transcript_path: '/no/such/transcript.jsonl' },
        { adapter: 'codex-cli' },
      ).status,
    ).toBe(0);
  });

  it('exits 0 with a Gemini AfterAgent payload carrying only an inline prompt_response', () => {
    expect(
      run(
        projectRoot,
        { session_id: 's', transcript_path: '', prompt_response: 'no markers here' },
        { adapter: 'gemini-cli' },
      ).status,
    ).toBe(0);
  });
});

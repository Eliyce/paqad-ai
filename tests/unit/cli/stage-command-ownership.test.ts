import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import * as recorder from '@/stage-evidence/recorder.js';
import { cleanupScopeFixtures, repoRoot } from '../hud/scope-fixtures.js';

describe('stage start prints the real refusal (B5)', () => {
  let root: string;

  beforeEach(() => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', undefined);
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    root = repoRoot('fix/x');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    cleanupScopeFixtures();
  });

  async function run(session: string, ...args: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      out.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      err.push(String(line));
    });
    process.exitCode = undefined;
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', session], {
      from: 'user',
    });
    const exitCode = process.exitCode;
    vi.restoreAllMocks();
    return { out, err, exitCode };
  }

  it('AC-19: a second session gets the ownership refusal with the --title hint and exit 1', async () => {
    const first = await run('ses_owner_a', 'start', 'planning');
    expect(first.exitCode).toBeUndefined();

    const second = await run('ses_other_b', 'start', 'planning');

    expect(second.exitCode).toBe(1);
    const text = second.err.join('\n');
    expect(text).toContain('another session is running a stage');
    expect(text).toContain('--title');
    expect(text).not.toContain('unknown stage');
  });

  it('AC-20: an unknown stage name still prints unknown stage and exits 1', async () => {
    const result = await run('ses_owner_a', 'start', 'nonsense');
    expect(result.exitCode).toBe(1);
    expect(result.err.join('\n')).toContain('unknown stage "nonsense"');
  });

  it('AC-20: an injected writer failure for a valid stage prints that error, never unknown stage', async () => {
    vi.spyOn(recorder, 'startStage').mockImplementation(() => {
      throw new Error('disk full while writing the stage row');
    });
    const result = await run('ses_owner_a', 'start', 'planning');
    expect(result.exitCode).toBe(1);
    const text = result.err.join('\n');
    expect(text).toContain('disk full while writing the stage row');
    expect(text).not.toContain('unknown stage');
  });
});

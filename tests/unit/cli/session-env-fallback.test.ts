import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeatureCommand } from '@/cli/commands/feature.js';
import { createLaneCommand } from '@/cli/commands/lane.js';
import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const COMMANDS: [string, () => Command, string[]][] = [
  ['lane set', createLaneCommand, ['set', 'full']],
  ['lane show', createLaneCommand, ['show']],
  ['pipeline status', createSpecPipelineCommand, ['status']],
  ['feature report', createFeatureCommand, ['report', '--quiet']],
  ['feature export', createFeatureCommand, ['export', '01JABCDEFGHJKMNPQRSTVWXYZ2']],
];

describe('session id fallbacks on change-scoped commands', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-session-env-'));
    out = [];
    err = [];
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line?: unknown) => void err.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(create: () => Command, args: string[]): Promise<void> {
    await create().parseAsync([...args, '--project-root', root], { from: 'user' });
  }

  it.each(COMMANDS)('%s finds no change when no session is known', async (_name, create, args) => {
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    await run(create, args);
    expect(process.exitCode).toBe(1);
  });

  it.each(COMMANDS)(
    '%s reads the change of the CLAUDE_SESSION_ID session',
    async (_name, create, args) => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', 'ses-claude');
      openFeatureChange(root, 'ses-claude', {
        adapter: 'claude-code',
        title: 'session fallback',
        issue: null,
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
      });
      await run(create, args);
      expect(err.join('\n')).not.toMatch(/no active feature/);
    },
  );

  it('prefers SE_SESSION over CLAUDE_SESSION_ID', async () => {
    vi.stubEnv('SE_SESSION', 'ses-se');
    vi.stubEnv('CLAUDE_SESSION_ID', 'ses-claude');
    await run(createLaneCommand, ['show']);
    expect(err).toEqual(['no active feature — run `paqad-ai stage start planning` first']);
  });
});

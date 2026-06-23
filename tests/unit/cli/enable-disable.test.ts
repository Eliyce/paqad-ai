import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDisableCommand } from '@/cli/commands/disable.js';
import { createEnableCommand } from '@/cli/commands/enable.js';
import { createProgram } from '@/cli/program.js';
import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';

const MINIMAL_PROFILE = `project:
  name: demo
  id: demo
  description: test
active_capabilities:
  - content
`;

describe('paqad-ai enable / disable commands', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-toggle-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/project-profile.yaml'), MINIMAL_PROFILE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('registers both commands on the program', () => {
    const names = createProgram()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toContain('enable');
    expect(names).toContain('disable');
  });

  it('disable flips paqad.enabled to false, enable flips it back', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createDisableCommand().parseAsync(['--project-root', root], { from: 'user' });
    expect(isFrameworkDisabledForRoot(root, {} as NodeJS.ProcessEnv)).toBe(true);

    await createEnableCommand().parseAsync(['--project-root', root], { from: 'user' });
    expect(isFrameworkDisabledForRoot(root, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('disable errors (exit code 1) when the project is not onboarded', async () => {
    const bareRoot = mkdtempSync(join(tmpdir(), 'paqad-cli-bare-'));
    try {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      process.exitCode = 0;
      await createDisableCommand().parseAsync(['--project-root', bareRoot], { from: 'user' });
      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('not onboarded'));
      process.exitCode = 0;
    } finally {
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});

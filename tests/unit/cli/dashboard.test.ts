import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardCommand } from '@/cli/commands/dashboard';

describe('createDashboardCommand', () => {
  let root: string;
  let stderr: ReturnType<typeof vi.spyOn>;
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-cli-'));
    errors = [];
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  it('errors when the project is not onboarded', async () => {
    const cmd = createDashboardCommand();
    await cmd.parseAsync(['--project-root', root, '--no-open'], { from: 'user' });
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/no \.paqad\/ directory/);
  });

  it('errors on invalid --port values', async () => {
    const cmd = createDashboardCommand();
    await cmd.parseAsync(['--port', 'banana', '--project-root', root, '--no-open'], { from: 'user' });
    expect(process.exitCode).toBe(2);
  });
});

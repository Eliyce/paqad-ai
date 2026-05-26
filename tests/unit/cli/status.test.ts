import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStatusCommand } from '@/cli/commands/status';

describe('createStatusCommand', () => {
  let root: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let writes: string[];
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-status-cli-'));
    writes = [];
    errors = [];
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
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
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  function bootstrap(): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ framework_version: '1.0.0', project_root: '.' }),
    );
  }

  it('rejects unknown --format values', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--format', 'xml', '--project-root', root], { from: 'user' });
    expect(process.exitCode).toBe(2);
    expect(errors.join('')).toMatch(/invalid --format/);
  });

  it('emits Markdown by default', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--project-root', root], { from: 'user' });
    const out = writes.join('');
    expect(out).toMatch(/# paqad-ai status/);
  });

  it('emits JSON when --format json is set', async () => {
    bootstrap();
    const cmd = createStatusCommand();
    await cmd.parseAsync(['--format', 'json', '--project-root', root], { from: 'user' });
    const out = writes.join('').trim();
    const parsed = JSON.parse(out) as { schemaVersion: number; notOnboarded: boolean };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.notOnboarded).toBe(false);
  });
});

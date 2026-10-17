import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOnboardCommand } from '@/cli/commands/onboard.js';

let root: string;
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-onboard-cli-'));
  savedExitCode = process.exitCode;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  process.exitCode = savedExitCode;
});

async function runOnboard(args: string[]): Promise<{ out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  try {
    await createOnboardCommand().parseAsync(args, { from: 'user' });
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out, err };
}

describe('paqad-ai onboard (issue #616, Part 8)', () => {
  it('--detect --json prints the detection and writes nothing', async () => {
    const { out } = await runOnboard(['--detect', '--json', '--project-root', root]);
    const report = JSON.parse(out) as Record<string, unknown>;
    expect(report).toHaveProperty('detected_stack');
    expect(report).toHaveProperty('detected_capabilities');
    expect(report).toHaveProperty('confidence');
    // Read-only: it detects (which may cache an introspection snapshot) but writes no onboarding
    // artifacts — no project profile, framework pointer, or provider entry files.
    expect(existsSync(join(root, '.paqad', 'project-profile.yaml'))).toBe(false);
    expect(existsSync(join(root, '.paqad', 'framework-path.txt'))).toBe(false);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  it('--non-interactive exits 2 with `missing --providers` when a selection is absent and stdin is not a TTY', async () => {
    const { err } = await runOnboard(['--non-interactive', '--project-root', root]);
    expect(err).toContain('missing --providers');
    expect(process.exitCode).toBe(2);
    expect(existsSync(join(root, '.paqad', 'project-profile.yaml'))).toBe(false);
  });

  // Issue #641 — a bad --stack value lists the valid stacks instead of an opaque schema error.
  it('--stack with an unknown value exits 2 and lists the valid stacks', async () => {
    const { err } = await runOnboard([
      '--stack',
      'node',
      '--project-root',
      root,
      '--non-interactive',
    ]);
    expect(err).toContain('unknown stack "node"');
    expect(err).toContain('node-library');
    expect(err).toContain('node-cli');
    expect(process.exitCode).toBe(2);
    expect(existsSync(join(root, '.paqad', 'project-profile.yaml'))).toBe(false);
  });
});

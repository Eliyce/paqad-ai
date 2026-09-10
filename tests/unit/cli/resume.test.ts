import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResumeCommand } from '@/cli/commands/resume.js';
import { createStageCommand } from '@/cli/commands/stage.js';
import { createProgram } from '@/cli/program.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import { closeActiveFeature, currentFeature } from '@/feature-evidence/stage-ledger.js';

// `paqad-ai resume --feature <ref>` — reactivate a feature-development change (issue
// #339), whether the session control still holds it or it is only recorded on disk (#540).
describe('paqad-ai resume command', () => {
  let root: string;
  const SES = 'ses_cli_resume';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-resume-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  /** Run `stage start planning` (optionally with a --title) under the fixed session. */
  async function stage(...args: string[]): Promise<void> {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
  }

  async function resume(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
    await createResumeCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return lines;
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('resume');
  });

  it('reactivates a paused feature by issue ref', async () => {
    // Feature A (issue 339) opened, then B — so A is paused and B is active.
    await stage('start', 'planning', '--title', 'Route first workflows', '--issue', '339');
    await stage('start', 'planning', '--title', 'Second feature', '--issue', '340');
    const active = currentFeature(root, SES)!;
    expect(active.startsWith('340-')).toBe(true);

    const lines = await resume('--feature', '339');
    expect(lines.some((line) => line.includes('"resumed":true'))).toBe(true);
    expect(currentFeature(root, SES)!.startsWith('339-')).toBe(true);
  });

  it('exits non-zero when the ref matches no recorded change', async () => {
    await stage('start', 'planning', '--title', 'Only feature', '--issue', '339');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(String(line)));
    await resume('--feature', 'does-not-exist');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not resume');
  });

  // Issue #540, AC-3: a change the session control has released — closed, or displaced
  // while a rollover took the pointer — is reachable from the CLI, with no hand-edit to
  // `.paqad/ledger/feature-evidence/_session/<id>.json`.
  it('reaches a change the session control no longer holds (#540)', async () => {
    await stage('start', 'planning', '--title', 'Displaced feature', '--issue', '540');
    const displaced = currentFeature(root, SES)!;
    expect(displaced.startsWith('540-')).toBe(true);
    // Release it exactly as the finalizer does when the change passes.
    closeActiveFeature(root, SES);
    expect(currentFeature(root, SES)).toBeNull();
    expect(readSessionControl(root, SES)).toMatchObject({ active: null, paused: [] });

    const lines = await resume('--feature', '540');

    expect(lines.some((line) => line.includes('"resumed":true'))).toBe(true);
    expect(currentFeature(root, SES)).toBe(displaced);
  });
});

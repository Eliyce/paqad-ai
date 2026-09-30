import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLaneCommand } from '@/cli/commands/lane.js';
import { createProgram } from '@/cli/program.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

// `paqad-ai lane set <lane>` — the operator lane override (issue #602, FR-1/FR-3).
describe('paqad-ai lane command', () => {
  let root: string;
  const SES = 'ses_cli_lane';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-lane-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function openFast(): string {
    return openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'fast' });
  }

  async function run(...args: string[]): Promise<{ lines: string[]; errors: string[] }> {
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await createLaneCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return { lines, errors };
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('lane');
  });

  it('raises the recorded lane the isolation check reads (FR-1, AC-2)', async () => {
    const dir = openFast();
    const { lines } = await run('set', 'full');
    expect(readChangeConstants(root, dir).lane).toBe('full');
    expect(lines.join('\n')).toContain('lane raised to full');
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({ set: true, lane: 'full', requested: 'full', changed: true });
  });

  it('refuses a downgrade and keeps the higher lane (FR-3, AC-3)', async () => {
    const dir = openFast();
    await run('set', 'full');
    const { lines } = await run('set', 'fast');
    expect(readChangeConstants(root, dir).lane).toBe('full');
    expect(lines.join('\n')).toContain("won't be downgraded");
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({
      lane: 'full',
      requested: 'fast',
      changed: false,
      refused_downgrade: true,
    });
  });

  it('reports no-op when the lane already matches', async () => {
    openFast();
    const { lines } = await run('set', 'fast');
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({ lane: 'fast', changed: false, refused_downgrade: false });
    expect(lines.join('\n')).toContain('already fast');
  });

  it('rejects an unknown lane', async () => {
    openFast();
    const { errors } = await run('set', 'huge');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown lane "huge"');
  });

  it('errors with no active feature', async () => {
    const { errors } = await run('set', 'full');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('no active feature');
  });

  it('show prints the recorded lane', async () => {
    openFast();
    const { lines } = await run('show');
    expect(JSON.parse(lines.at(-1)!)).toEqual({ lane: 'fast' });
  });
});

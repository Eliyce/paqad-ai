import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeliveryLinkCommand } from '@/cli/commands/delivery-link.js';
import { createProgram } from '@/cli/program.js';
import { readFeatureDelivery } from '@/feature-evidence/delivery.js';
import { featureReportPath } from '@/feature-evidence/paths.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

describe('paqad-ai delivery-link', () => {
  let root: string;
  const SES = 'ses_cli_dl';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-dl-'));
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    g('init', '-q', '-b', 'feat/x');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    writeFileSync(join(root, 'a.txt'), 'a');
    g('add', '-A');
    g('commit', '-q', '-m', 'feat: work');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(String(l)));
    await createDeliveryLinkCommand().parseAsync(
      [...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    return lines;
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('delivery-link');
  });

  it('commit records HEAD against the active feature', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('commit');
    expect(lines.some((l) => l.includes('"linked":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    expect(readFeatureDelivery(root, dir).commits).toHaveLength(1);
  });

  it('commit regenerates the feature report after linking (AC-6, #371)', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    await run('commit');
    const dir = currentFeature(root, SES)!;
    expect(existsSync(join(root, featureReportPath(dir)))).toBe(true);
  });

  it('commit reports linked:false when no feature is active', async () => {
    const lines = await run('commit');
    expect(lines.some((l) => l.includes('"linked":false'))).toBe(true);
  });

  it('reconcile backfills the active feature from local git', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('reconcile');
    expect(lines.some((l) => l.includes('"reconciled":true'))).toBe(true);
  });

  it('merge stamps the merge commit on the active feature', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('merge');
    expect(lines.some((l) => l.includes('"linked":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    expect(readFeatureDelivery(root, dir).merge_commit).not.toBeNull();
  });

  it('reconcile reports reconciled:false when no feature can be resolved', async () => {
    const lines = await run('reconcile');
    expect(lines.some((l) => l.includes('"reconciled":false'))).toBe(true);
  });

  it('merge reports linked:false when there is no feature to stamp', async () => {
    const lines = await run('merge');
    expect(lines.some((l) => l.includes('"linked":false'))).toBe(true);
  });

  it('install writes the git hooks', async () => {
    const lines = await run('install');
    expect(lines.some((l) => l.includes('post-commit'))).toBe(true);
    expect(existsSync(join(root, '.git', 'hooks', 'post-commit'))).toBe(true);
  });
});

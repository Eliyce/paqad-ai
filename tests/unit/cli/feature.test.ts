import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeatureCommand } from '@/cli/commands/feature.js';
import { createProgram } from '@/cli/program.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

describe('paqad-ai feature command', () => {
  let root: string;
  const SES = 'ses_cli_feature';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-feature-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => lines.push(String(l)));
    await createFeatureCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return lines;
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('feature');
  });

  it('export writes a bundle document to --out', async () => {
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Route first',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    const out = join(root, 'export.json');
    const lines = await run('export', '339', '--out', out);
    expect(lines.some((l) => l.includes('"exported":true'))).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8')).dir_name).toBe(dir);
  });

  it('export prints the bundle to stdout when no --out is given', async () => {
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Route first',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    const lines = await run('export', '339');
    expect(lines.join('\n')).toContain('"dir_name"');
  });

  it('export exits non-zero for an unknown ref', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run('export', 'nope');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not resolve feature');
  });

  it('report renders report.html for the active feature and prints its path (#371)', async () => {
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Reportable',
      issue: null,
    });
    const lines = await run('report', '--quiet');
    const payload = lines.map((l) => l.trim()).find((l) => l.startsWith('{'))!;
    const parsed = JSON.parse(payload);
    expect(parsed.rendered).toBe(true);
    expect(parsed.feature).toBe(dir);
    expect(existsSync(parsed.path)).toBe(true);
    expect(readFileSync(parsed.path, 'utf8')).not.toMatch(/<script/i);
  });

  it('report exits non-zero for an unknown ref', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run('report', 'nope-nothing');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not resolve feature');
  });

  it('prune reports how many bundles were removed', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const lines = await run('prune', '--keep', '10');
    expect(lines.some((l) => l.includes('"removed":0'))).toBe(true);
  });

  it('prune rejects a non-numeric --keep', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    await run('prune', '--keep', 'lots');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--keep must be');
  });
});

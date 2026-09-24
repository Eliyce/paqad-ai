import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVisualEvidenceCommand } from '@/cli/commands/visual-evidence.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readVisualEvidenceManifest } from '@/visual-evidence/manifest.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';

// Issue #579 (AC-15) — `paqad-ai visual-evidence attach` refuses with one plain line and exit 1,
// writing nothing, when the flag is off, no bundle is active, or a file is missing / not a PNG.

const SES = 'ses_cli_ve_attach';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('img'),
]);

describe('paqad-ai visual-evidence attach', () => {
  let root: string;
  let errors: string[];
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-ve-attach-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    errors = [];
    logs = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(String(line)));
    vi.spyOn(console, 'log').mockImplementation((line: string) => logs.push(String(line)));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function codingProject(visualEvidence: boolean): void {
    writeProjectProfile(root, {
      ...fixtureProfile('laravel'),
      active_capabilities: ['coding'],
    } as never);
    writeFileSync(join(root, '.paqad', '.config'), `visual_evidence=${visualEvidence}\n`);
  }

  function png(name: string): string {
    const path = join(root, name);
    writeFileSync(path, PNG);
    return path;
  }

  /** Write a frozen specification.json into the bundle carrying the given criterion ids. */
  function frozenSpec(dir: string, ids: string[] | null): void {
    const path = join(root, featureFilePath(dir, 'specification'));
    mkdirSync(join(root, featureDir(dir)), { recursive: true });
    const spec: Record<string, unknown> = {
      spec_id: 'S-1',
      frozen: { frozen_at: '2026-09-24T00:00:00.000Z' },
    };
    if (ids) spec.acceptance_criteria = ids.map((criterion_id) => ({ criterion_id }));
    writeFileSync(path, JSON.stringify(spec));
  }

  async function attach(...args: string[]): Promise<void> {
    await createVisualEvidenceCommand().parseAsync(
      ['attach', ...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
  }

  it('attaches a screenshot into the active bundle', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    await attach(png('shot.png'), '--ac', 'AC-3', '--label', 'Goal saved');
    expect(process.exitCode).toBeUndefined();
    const manifest = readVisualEvidenceManifest(root, dir)!;
    expect(manifest.source).toBe('agent-attached');
    expect(manifest.steps[0]!.ac).toBe('AC-3');
    expect(manifest.steps[0]!.caption).toBe('Goal saved');
    expect(logs.join('\n')).toContain('attached 1 screenshot(s)');
  });

  it('warns and accepts an --ac id when the bundle has no frozen spec to check it against', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 4 });
    await attach(png('shot.png'), '--ac', 'AC-9');
    expect(process.exitCode).toBeUndefined();
    expect(errors).toEqual([
      '▸ paqad · visual evidence attach: no frozen spec in this bundle, so AC-9 was not checked against its acceptance criteria.',
    ]);
    expect(readVisualEvidenceManifest(root, dir)!.steps[0]!.ac).toBe('AC-9');
  });

  it('accepts an --ac id the frozen spec defines, without a warning', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 5 });
    frozenSpec(dir, ['AC-1', 'AC-2']);
    await attach(png('shot.png'), '--ac', 'AC-2');
    expect(process.exitCode).toBeUndefined();
    expect(errors).toEqual([]);
    expect(readVisualEvidenceManifest(root, dir)!.steps[0]!.ac).toBe('AC-2');
  });

  it('refuses an --ac id the frozen spec does not define, naming the valid ids', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 6 });
    frozenSpec(dir, ['AC-1', 'AC-2']);
    await attach(png('shot.png'), '--ac', 'AC-7');
    expect(process.exitCode).toBe(1);
    expect(errors).toEqual([
      '▸ paqad · visual evidence attach refused: AC-7 is not an acceptance criterion of the frozen spec. Valid ids: AC-1, AC-2.',
    ]);
    expect(existsSync(join(root, featureDir(dir), 'screenshots'))).toBe(false);
    expect(existsSync(join(root, featureFilePath(dir, 'visualEvidence')))).toBe(false);
  });

  it('refuses any --ac id when the frozen spec lists no criteria', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 7 });
    frozenSpec(dir, null);
    await attach(png('shot.png'), '--ac', 'AC-1');
    expect(process.exitCode).toBe(1);
    expect(errors[0]).toContain('Valid ids: none (the frozen spec has no criteria).');
  });

  it('refuses when visual evidence is off', async () => {
    codingProject(false);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 2 });
    await attach(png('shot.png'));
    expect(process.exitCode).toBe(1);
    expect(errors).toEqual([
      '▸ paqad · visual evidence attach refused: visual evidence is off (flag off or coding capability absent).',
    ]);
    expect(existsSync(join(root, featureFilePath(dir, 'visualEvidence')))).toBe(false);
  });

  it('refuses when no feature bundle is active', async () => {
    codingProject(true);
    await attach(png('shot.png'));
    expect(process.exitCode).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no active feature bundle');
  });

  it('refuses a non-png and a missing file, writing nothing into the bundle', async () => {
    codingProject(true);
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 3 });
    const text = join(root, 'notes.txt');
    writeFileSync(text, 'hello');

    await attach(text);
    expect(process.exitCode).toBe(1);
    expect(errors[0]).toContain('is not a PNG image');

    await attach(join(root, 'missing.png'));
    expect(errors[1]).toContain('does not exist');
    expect(errors).toHaveLength(2);
    expect(existsSync(join(root, featureDir(dir), 'screenshots'))).toBe(false);
    expect(existsSync(join(root, featureFilePath(dir, 'visualEvidence')))).toBe(false);
  });
});

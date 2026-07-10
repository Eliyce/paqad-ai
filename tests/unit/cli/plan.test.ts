import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanCommand } from '@/cli/commands/plan.js';
import { createProgram } from '@/cli/program.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

describe('paqad-ai plan compile', () => {
  let root: string;
  const SES = 'ses_cli_plan';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-plan-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
    await createPlanCommand().parseAsync(
      ['compile', ...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    return lines;
  }

  function writeTemplate(body: unknown): string {
    const path = join(root, 'plan-input.json');
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('plan');
  });

  it('compiles plan.json into the active feature and deletes the transient input', async () => {
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Route first workflows',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    const input = writeTemplate({
      summary: 'Route every prompt to one of nine workflows',
      steps: [{ id: 's1', description: 'add the router' }],
    });
    const lines = await run(input);
    expect(lines.some((l) => l.includes('"compiled":true'))).toBe(true);
    const dir = currentFeature(root, SES)!;
    expect(readFeaturePlan(root, dir)?.summary).toBe('Route every prompt to one of nine workflows');
    // Transient scratch: the input file is gone.
    expect(existsSync(input)).toBe(false);
  });

  it('keeps the input with --keep-input', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 1 });
    const input = writeTemplate({ summary: 'keep me' });
    await run(input, '--keep-input');
    expect(existsSync(input)).toBe(true);
  });

  it('exits non-zero when no feature is active', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    const input = writeTemplate({ summary: 'orphan plan' });
    await run(input);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('No active feature');
  });

  it('exits non-zero on a malformed template', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    const path = join(root, 'bad.json');
    writeFileSync(path, '{ not json');
    await run(path);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not read/parse');
  });

  it('exits non-zero when the compiled record fails schema validation', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 2 });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    // A step with an empty description is rejected by PLAN_SCHEMA (minLength 1), so the
    // compile throws a non-NoActiveFeature error — the generic error branch.
    const input = writeTemplate({ summary: 'ok', steps: [{ id: 's1', description: '' }] });
    await run(input);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('could not compile plan');
  });

  it('exits non-zero when summary is missing', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    const input = writeTemplate({ steps: [] });
    await run(input);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('non-empty "summary"');
  });
});

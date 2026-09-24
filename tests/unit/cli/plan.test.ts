import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanCommand } from '@/cli/commands/plan.js';
import { createProgram } from '@/cli/program.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { readContractDecisions } from '@/decisions/authoring.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';

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

  function writeTemplate(body: Record<string, unknown>): string {
    const path = join(root, 'plan-input.json');
    // Issue #357 — every compile needs a reuse declaration, so the fixtures carry a
    // minimal valid one unless a test is deliberately exercising its absence.
    const withReuse =
      'reuse' in body
        ? body
        : {
            ...body,
            reuse: {
              consulted: [{ source: 'grep', query: 'x', hits: 0 }],
              reusing: [],
              new_constructs: [],
            },
          };
    writeFileSync(path, JSON.stringify(withReuse));
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

  // Issue #357 — the reuse gate at the CLI boundary.
  it('refuses a template with no reuse section and prints the expected shape (AC-1)', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 3 });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: string) => errors.push(String(l)));
    const input = writeTemplate({ summary: 'no reuse declared', reuse: undefined });
    await run(input);
    expect(process.exitCode).toBe(1);
    const printed = errors.join('\n');
    expect(printed).toContain('missing the required "reuse" section');
    expect(printed).not.toContain('could not compile plan');
    // Nothing was written, and the transient input survives a failed compile.
    expect(readFeaturePlan(root, currentFeature(root, SES)!)).toBeNull();
    expect(existsSync(input)).toBe(true);
  });

  it('prints the unverified-claims warning when no index has been built (AC-3)', async () => {
    openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 4 });
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((l: string) => warnings.push(String(l)));
    const input = writeTemplate({
      summary: 'reuse something',
      reuse: {
        consulted: [{ source: 'grep', query: 'dates', hits: 1 }],
        reusing: [{ symbol: 'formatIsoDate', how: 'call as-is' }],
        new_constructs: [],
      },
    });
    await run(input);
    expect(process.exitCode).toBeUndefined();
    expect(warnings.join('\n')).toContain('reuse claims unverified: index not built');
  });

  describe('visual-evidence readiness pause (issue #579)', () => {
    function frontendProject(): void {
      writeProjectProfile(root, {
        ...fixtureProfile('laravel'),
        active_capabilities: ['coding'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      } as never);
      // site_map stays off, so this machine always fails a readiness check.
      writeFileSync(join(root, '.paqad', '.config'), 'visual_evidence=true\n');
    }

    it('AC-13: opens one readiness pause for a frontend plan, and a re-run opens no second', async () => {
      frontendProject();
      openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 7 });
      const warnings: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((l: string) => warnings.push(String(l)));
      const steps = [{ id: 's1', description: 'add the page', files: ['src/pages/Goals.tsx'] }];

      const lines = await run(writeTemplate({ summary: 'goals page', steps }));
      const packets = readContractDecisions(root);
      expect(packets).toHaveLength(1);
      const id = packets[0]!.packet.id;
      expect(warnings.join('\n')).toContain(
        `Visual evidence is on, but I can't capture screenshots here yet. Answer ${id}`,
      );
      expect(lines.some((l) => l.includes(`"readiness_decision":"${id}"`))).toBe(true);
      const dir = currentFeature(root, SES)!;
      expect(readFeaturePlan(root, dir)?.steps[0]?.files).toEqual(['src/pages/Goals.tsx']);

      await run(writeTemplate({ summary: 'goals page again', steps }));
      expect(readContractDecisions(root)).toHaveLength(1);
    });

    it('AC-8: opens no pause for a plan with no frontend files', async () => {
      frontendProject();
      openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 8 });
      const lines = await run(
        writeTemplate({
          summary: 'server only',
          steps: [{ id: 's1', description: 'add the api', files: ['src/server/api.ts'] }],
        }),
      );
      expect(readContractDecisions(root)).toEqual([]);
      expect(lines.some((l) => l.includes('readiness_decision'))).toBe(false);
    });
  });
});

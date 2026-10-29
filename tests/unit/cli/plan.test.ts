import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanCommand } from '@/cli/commands/plan.js';
import { createProgram } from '@/cli/program.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import {
  currentFeature,
  openFeatureChange,
  recordChangeConstants,
} from '@/feature-evidence/stage-ledger.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { readContractDecisions } from '@/decisions/authoring.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { writePendingImpact } from '@/stage-evidence/pending-lane.js';

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
    expect(existsSync(input)).toBe(false);
  });

  it.each([
    ['fast', 'fix', 1],
    ['full', 'fix', 0],
    ['fast', 'other', 0],
  ] as const)(
    'on the %s lane a %s change raises %i fix.proof_method packet(s) at compile',
    async (lane, kind, count) => {
      const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 7 });
      recordChangeConstants(root, dir, { lane, kind });
      const warnings: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((line: string) => void warnings.push(line));
      const lines = await run(writeTemplate({ summary: 'fix the login crash' }));
      const packets = readContractDecisions(root).filter(
        ({ packet }) => packet.category === 'fix.proof_method',
      );
      expect(packets).toHaveLength(count);
      expect(warnings.some((line) => line.includes('how to prove it'))).toBe(count === 1);
      const summary = JSON.parse(lines.at(-1)!);
      expect(summary.fix_proof_method).toBe(count === 1 ? packets[0]!.packet.id : undefined);
    },
  );

  it('compiles with no fix.proof_method when no change is active for the lane check', async () => {
    const lines = await run(writeTemplate({ summary: 'nothing open' }));
    expect(lines.some((l) => l.includes('fix_proof_method'))).toBe(false);
  });

  describe('plan-time lane resize', () => {
    function gitRepo(): void {
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
      git('init', '-q', '-b', 'feat/small');
      git('config', 'user.email', 't@t.dev');
      git('config', 'user.name', 'Test');
      writeFileSync(join(root, '.gitignore'), '.paqad/\nplan-input.json\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'chore: base');
    }

    function smallFullChange(): string {
      gitRepo();
      const dir = openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'Small change',
        issue: '901',
        lane: 'full',
      });
      writePendingImpact(root, SES, { database_impact: 'none', api_impact: 'none' });
      return dir;
    }

    it('prints one line and adds lane_resized to the JSON when the plan lowers the lane', async () => {
      const dir = smallFullChange();
      const lines = await run(
        writeTemplate({
          summary: 'small',
          steps: [{ id: 's1', description: 'edit', files: ['src/a.ts', 'src/b.ts'] }],
        }),
      );
      const resizeLines = lines.filter((line) => line.includes('lane set to'));
      expect(resizeLines).toEqual([
        '**▸ paqad** · lane set to graduated from full: the plan touches 2 files, none sensitive, no schema or breaking API change',
      ]);
      expect(JSON.parse(lines.at(-1)!).lane_resized).toMatchObject({
        from: 'full',
        to: 'graduated',
        files: 2,
      });
      expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
    });

    it('raises the lane back to full when a revised plan names a sensitive path', async () => {
      const dir = smallFullChange();
      await run(
        writeTemplate({
          summary: 'small',
          steps: [{ id: 's1', description: 'edit', files: ['src/a.ts'] }],
        }),
      );
      mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
      writeFileSync(
        join(root, 'docs/instructions/rules/module-map.yml'),
        'version: 2\nmodules:\n  - slug: secure\n    name: Secure\n    sensitivity: high\n    sources:\n      - src/secure\n',
      );
      const lines = await run(
        writeTemplate({
          summary: 'revised',
          steps: [{ id: 's1', description: 'edit', files: ['src/a.ts', 'src/secure/k.ts'] }],
        }),
      );
      expect(lines).toContain(
        '**▸ paqad** · lane raised to full from graduated: the change touches a sensitive path: src/secure/k.ts',
      );
      expect(lines.some((line) => line.includes('lane set to'))).toBe(false);
      expect(JSON.parse(lines.at(-1)!).lane_raised).toMatchObject({ to: 'full' });
      expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'plan' });
    });

    it('AC-7: keeps full when git cannot be read, and still compiles', async () => {
      const dir = openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'Small change',
        issue: '902',
        lane: 'full',
      });
      writePendingImpact(root, SES, { database_impact: 'none', api_impact: 'none' });
      const lines = await run(
        writeTemplate({
          summary: 'small',
          steps: [{ id: 's1', description: 'edit', files: ['src/a.ts'] }],
        }),
      );
      expect(process.exitCode).toBeUndefined();
      expect(lines.some((line) => line.includes('lane set to'))).toBe(false);
      expect(readFeatureRecord(root, dir)?.lane).toBe('full');
    });

    it('prints nothing extra and still compiles when the plan is too big to lower', async () => {
      const dir = smallFullChange();
      const files = Array.from({ length: 9 }, (_, i) => `src/f${i}.ts`);
      const lines = await run(
        writeTemplate({ summary: 'big', steps: [{ id: 's1', description: 'edit', files }] }),
      );
      expect(process.exitCode).toBeUndefined();
      expect(lines.some((line) => line.includes('lane set to'))).toBe(false);
      expect(JSON.parse(lines.at(-1)!).lane_resized).toBeUndefined();
      expect(readFeatureRecord(root, dir)?.lane).toBe('full');
    });
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

  describe('visual-evidence readiness pause', () => {
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
      writeFileSync(join(root, '.paqad', '.config'), 'visual_evidence=true\n');
    }

    it('AC-16: plan compile opens one readiness pause for a frontend plan without asking it, and a re-run opens no second', async () => {
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
        `Visual evidence is on, but I can't capture screenshots here yet. I raised ${id}`,
      );
      expect(warnings.join('\n')).not.toContain(`Answer ${id}`);
      expect(lines.some((l) => l.includes(`"readiness_decision":"${id}"`))).toBe(true);
      const dir = currentFeature(root, SES)!;
      expect(readFeaturePlan(root, dir)?.steps[0]?.files).toEqual(['src/pages/Goals.tsx']);

      await run(writeTemplate({ summary: 'goals page again', steps }));
      expect(readContractDecisions(root)).toHaveLength(1);
    });

    it('asks the readiness pause at once on the fast lane, where no question round follows', async () => {
      frontendProject();
      const dir = openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 8 });
      recordChangeConstants(root, dir, { lane: 'fast', kind: 'other' });
      const warnings: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((l: string) => warnings.push(String(l)));
      const steps = [{ id: 's1', description: 'add the page', files: ['src/pages/Goals.tsx'] }];

      await run(writeTemplate({ summary: 'goals page fast', steps }));
      const id = readContractDecisions(root)[0]!.packet.id;
      expect(warnings.join('\n')).toContain(`Answer ${id}`);
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

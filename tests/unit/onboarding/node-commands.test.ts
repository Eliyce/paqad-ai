import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { runChecks } from '@/checks/run-checks.js';
import type { ProjectCommands } from '@/core/types/project-profile.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { OnboardingOrchestrator } from '@/onboarding';

describe('onboarding maps Node commands from the lockfile and package.json scripts', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-node-commands-'));
    frameworkHome = mkdtempSync(join(tmpdir(), 'paqad-node-commands-home-'));
    rmSync(frameworkHome, { recursive: true, force: true });
    originalHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = originalHome;
  });

  function seed(scripts: Record<string, string>, lockfile?: string): void {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        scripts,
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vitest: '^3.0.0' },
      }),
    );
    if (lockfile) writeFileSync(join(projectRoot, lockfile), '');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/App.tsx'),
      'export default function App() { return null; }',
    );
  }

  async function onboard(): Promise<{ commands: ProjectCommands; warnings: string[] }> {
    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
    });
    const profile = YAML.parse(
      readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
    ) as { commands: ProjectCommands };
    return { commands: profile.commands, warnings: output.warnings };
  }

  it('maps only the test script for an npm repo and lists the rest as unmapped', async () => {
    seed({ test: 'vitest run' }, 'package-lock.json');
    const { commands, warnings } = await onboard();

    expect(commands.install).toBe('npm install');
    expect(commands.test.startsWith('npm test')).toBe(true);
    expect(commands.test_single.startsWith('npm test -- <pattern>')).toBe(true);
    expect(commands.dev).toBe('');
    expect(commands.lint).toBe('');
    expect(commands.format).toBe('');
    expect(commands.build).toBe('');
    expect(commands.migrate).toBe('');
    const unmapped = warnings.filter((warning) => warning.startsWith('Commands left unmapped'));
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toContain('dev, lint, format, migrate, build');
  });

  it.each([
    ['pnpm-lock.yaml', 'pnpm install', 'pnpm build', 'pnpm migrate'],
    ['yarn.lock', 'yarn install', 'yarn build', 'yarn migrate'],
    ['package-lock.json', 'npm install', 'npm run build', 'npm run migrate'],
    [undefined, 'npm install', 'npm run build', 'npm run migrate'],
  ])('picks the package manager from %s', async (lockfile, install, build, migrate) => {
    seed(
      {
        dev: 'vite',
        test: 'vitest run',
        lint: 'eslint .',
        format: 'prettier --write .',
        build: 'vite build',
        migrate: 'node migrate.js',
      },
      lockfile,
    );
    const { commands, warnings } = await onboard();

    expect(commands.install).toBe(install);
    expect(commands.build).toBe(build);
    expect(commands.migrate).toBe(migrate);
    expect(Object.values(commands).some((command) => command.includes('echo'))).toBe(false);
    expect(warnings.some((warning) => warning.startsWith('Commands left unmapped'))).toBe(false);
  });

  it('derives the yarn single-test command from the test script', async () => {
    seed({ test: 'vitest run' }, 'yarn.lock');
    const { commands } = await onboard();

    expect(commands.test.startsWith('yarn test')).toBe(true);
    expect(commands.test_single.startsWith('yarn test <pattern>')).toBe(true);
  });

  async function onboardReact(): Promise<{ commands: ProjectCommands; warnings: string[] }> {
    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'react', capabilities: [] },
    });
    const profile = YAML.parse(
      readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
    ) as { commands: ProjectCommands };
    return { commands: profile.commands, warnings: output.warnings };
  }

  function expectConventionalNpm(commands: ProjectCommands, warnings: string[]): void {
    expect(commands.install).toBe('npm install');
    expect(commands.dev).toBe('npm run dev');
    expect(commands.test.startsWith('npm test')).toBe(true);
    expect(commands.test_single.startsWith('npm test -- <pattern>')).toBe(true);
    expect(commands.lint).toBe('npm run lint');
    expect(commands.format).toBe('npm run format');
    expect(commands.build).toBe('npm run build');
    expect(commands.migrate).toBe('');
    expect(Object.values(commands).some((command) => command.includes('echo'))).toBe(false);
    const unmapped = warnings.filter((warning) => warning.startsWith('Commands left unmapped'));
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toContain(': migrate.');
  }

  it('maps the conventional npm commands when the project has no package.json yet', async () => {
    const { commands, warnings } = await onboardReact();
    expectConventionalNpm(commands, warnings);
  });

  it.each([
    ['declares no scripts', {}],
    ['has a scripts field that is not an object', { scripts: 'vitest run' }],
    ['has a scripts field that is a list', { scripts: ['test'] }],
  ])('maps only install when package.json %s', async (_label, extra) => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, ...extra }),
    );
    const { commands, warnings } = await onboardReact();

    expect(commands.install).toBe('npm install');
    for (const name of ['dev', 'test', 'test_single', 'lint', 'format', 'migrate', 'build']) {
      expect(commands[name as keyof ProjectCommands]).toBe('');
    }
    const unmapped = warnings.filter((warning) => warning.startsWith('Commands left unmapped'));
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toContain('dev, test, test_single, lint, format, migrate, build');
  });

  it('maps the conventional commands when package.json cannot be parsed', async () => {
    writeFileSync(join(projectRoot, 'package.json'), '{ not json');
    const { commands, warnings } = await onboardReact();
    expectConventionalNpm(commands, warnings);
  });

  it('leaves test and test_single empty when there is no test script', async () => {
    seed({ build: 'vite build' }, 'pnpm-lock.yaml');
    const { commands, warnings } = await onboard();

    expect(commands.test).toBe('');
    expect(commands.test_single).toBe('');
    expect(commands.build).toBe('pnpm build');
    expect(warnings.find((warning) => warning.startsWith('Commands left unmapped'))).toContain(
      'test, test_single',
    );
  });

  it('runs only the mapped commands and skips the unmapped ones with a note', async () => {
    seed({ test: 'vitest run' }, 'package-lock.json');
    await onboard();

    const spawned: string[] = [];
    const shell: DeliveryShell = {
      async run(bin, args) {
        spawned.push([bin, ...args].join(' '));
        return { stdout: 'TAP version 13\nok 1 - works\n1..1\n', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      nowMs: () => 0,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(result.passed).toBe(true);
    expect(result.commands.map((command) => command.logical_command)).toEqual(['test']);
    expect(spawned.every((line) => line.startsWith('npm test'))).toBe(true);
    expect(result.warnings).toContain('format is not mapped in the profile; skipped');
    expect(result.warnings).toContain('build is not mapped in the profile; skipped');
    expect(result.warnings.some((warning) => warning.includes('was not found'))).toBe(false);
  });
});

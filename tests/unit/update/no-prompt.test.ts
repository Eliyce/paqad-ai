import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as prompts from '@inquirer/prompts';
import YAML from 'yaml';

import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import { FrameworkUpdater } from '@/update/index.js';

vi.mock('@inquirer/prompts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.keys(actual).map((name) => [
      name,
      vi.fn(async () => {
        throw new Error(`update asked a question through ${name}`);
      }),
    ]),
  );
});

function writeProfile(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
      commands: {
        install: 'pnpm install',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test -- one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'pnpm migrate',
        build: 'pnpm build',
      },
      compliance_packs: [],
      mcp: { servers: [] },
    }),
  );
}

function writeManifest(projectRoot: string, fields: Record<string, unknown>): void {
  writeFileSync(
    join(projectRoot, '.paqad/onboarding-manifest.json'),
    `${JSON.stringify(
      {
        project_root: '.',
        profile: {},
        detected: null,
        generated_at: '2026-01-01T00:00:00.000Z',
        ...fields,
      },
      null,
      2,
    )}\n`,
  );
}

function readManifest(projectRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, '.paqad/onboarding-manifest.json'), 'utf8'));
}

function promptCalls(): number {
  return Object.values(prompts).reduce(
    (total, fn) => total + (vi.isMockFunction(fn) ? fn.mock.calls.length : 0),
    0,
  );
}

describe('paqad-ai update in a terminal', () => {
  let projectRoot: string;
  let userHome: string;
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  };

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-update-tty-'));
    userHome = mkdtempSync(join(tmpdir(), 'paqad-update-tty-home-'));
    process.env.HOME = userHome;
    process.env.USERPROFILE = userHome;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    writeProfile(projectRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
    for (const key of ['HOME', 'USERPROFILE'] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    for (const stream of ['stdin', 'stdout'] as const) {
      const descriptor = saved[stream];
      if (descriptor) Object.defineProperty(process[stream], 'isTTY', descriptor);
      else delete (process[stream] as { isTTY?: boolean }).isTTY;
    }
  });

  it('asks nothing and works the providers out from the recorded entry files', async () => {
    writeManifest(projectRoot, {
      adapter: 'claude-code',
      generated_artifacts: [
        { path: 'CLAUDE.md', auto_update: true },
        { path: 'AGENTS.md', auto_update: true },
      ],
    });
    const run = vi.spyOn(OnboardingOrchestrator.prototype, 'run');

    const report = await new FrameworkUpdater().run(projectRoot);

    expect(promptCalls()).toBe(0);
    expect(run.mock.calls[0][0]).toMatchObject({
      interactive: false,
      selections: { providers: ['claude-code', 'codex-cli'] },
    });
    expect(report.regenerated).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md']));
    expect(readManifest(projectRoot)).toMatchObject({
      adapter: 'claude-code',
      providers: ['claude-code', 'codex-cli'],
    });
  }, 60_000);

  it('passes the saved providers through unchanged and keeps the adapter', async () => {
    const providers = ['codex-cli', 'claude-code', 'gemini-cli', 'junie'];
    writeManifest(projectRoot, {
      adapter: 'codex-cli',
      providers,
      generated_artifacts: [{ path: 'AGENTS.md', auto_update: true }],
    });
    const run = vi.spyOn(OnboardingOrchestrator.prototype, 'run');

    await new FrameworkUpdater().run(projectRoot);

    expect(promptCalls()).toBe(0);
    expect(run.mock.calls[0][0].selections?.providers).toEqual(providers);
    expect(readManifest(projectRoot)).toMatchObject({ adapter: 'codex-cli', providers });
  }, 60_000);
});

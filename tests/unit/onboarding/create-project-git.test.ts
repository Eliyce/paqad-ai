import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectWorkspace } from '@/onboarding/create-project.js';

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }));
const { run } = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('execa', () => ({ execa }));

// The onboarding run is exercised fully elsewhere; here it is stubbed so these tests isolate
// the git / slug / error-handling branches of the thin creation wrapper.
vi.mock('@/onboarding/orchestrator.js', () => ({
  OnboardingOrchestrator: class {
    run = run;
  },
}));

const RUN_OUTPUT = {
  adapter: 'claude-code',
  decision_pause_supported_adapters: ['claude-code'],
  generated_files: ['CLAUDE.md'],
  detected_modules: [],
  runtime_root: '.',
  manifest_path: '.paqad/onboarding-manifest.json',
  warnings: [],
  reverted_framework_values: [],
};

describe('createProjectWorkspace git + slug branches', () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'paqad-ai-new-git-'));
    execa.mockReset();
    run.mockReset();
    run.mockResolvedValue(RUN_OUTPUT);
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('records a recovery note (and leaves git uninitialized) when git init fails', async () => {
    execa.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve({ exitCode: 128, stdout: '' });
      }
      // `git init` fails.
      return Promise.reject(new Error('git missing'));
    });

    const result = await createProjectWorkspace({ name: 'g', parentDir });

    expect(result.gitInitialized).toBe(false);
    expect(result.recovery).toContain('git init failed');
    expect(result.recovery).toContain('git missing');
  });

  it('reports "unknown error" when git init rejects with a non-Error value', async () => {
    execa.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve({ exitCode: 128, stdout: '' });
      }
      return Promise.reject('boom');
    });

    const result = await createProjectWorkspace({ name: 'g2', parentDir });
    expect(result.recovery).toContain('unknown error');
  });

  it('treats a throwing rev-parse as "not inside a work tree" and still inits', async () => {
    execa.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') {
        return Promise.reject(new Error('spawn failure'));
      }
      return Promise.resolve({ exitCode: 0, stdout: '' });
    });

    const result = await createProjectWorkspace({ name: 'g3', parentDir });
    expect(result.gitInitialized).toBe(true);
    expect(result.recovery).toBeUndefined();
  });

  it('skips git init when already inside a work tree', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'true\n' });

    const result = await createProjectWorkspace({ name: 'g4', parentDir });
    expect(result.gitInitialized).toBe(false);
    // Only the rev-parse probe ran — no init call.
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it('falls back to a default project id when the name slugs to empty', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'true\n' });

    await createProjectWorkspace({ name: '###', parentDir, providers: ['claude-code'] });

    const overrides = run.mock.calls[0]![0].profileOverrides;
    expect(overrides.project.id).toBe('paqad-project');
    expect(run.mock.calls[0]![0].selections.providers).toEqual(['claude-code']);
    expect(existsSync(join(parentDir, '###'))).toBe(true);
  });

  it('defaults providers to claude-code when none are supplied', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'true\n' });

    await createProjectWorkspace({ name: 'p', parentDir, providers: [] });

    expect(run.mock.calls[0]![0].selections.providers).toEqual(['claude-code']);
  });

  it('defaults the parent directory to the current working directory', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'true\n' });
    vi.spyOn(process, 'cwd').mockReturnValue(parentDir);

    const result = await createProjectWorkspace({ name: 'cwd-app' });

    expect(result.projectRoot).toBe(join(parentDir, 'cwd-app'));
  });
});

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ValidationError } from '@/core/errors/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { OnboardingOrchestrator } from '@/onboarding';

const SELECTIONS = { domain: 'coding', stack: 'laravel', capabilities: [] } as const;

describe('OnboardingOrchestrator.preview', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-preview-'));
    frameworkHome = join(tmpdir(), `paqad-ai-preview-home-${Date.now()}`);
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
  });

  it('marks every file create on an empty directory and writes nothing', async () => {
    const result = await new OnboardingOrchestrator().preview({
      projectRoot,
      selections: SELECTIONS,
    });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((entry) => entry.action === 'create')).toBe(true);
    expect(result.entries.some((entry) => entry.path === 'CLAUDE.md')).toBe(true);
    // Nothing was written: the project directory is still empty after the preview.
    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('produces a byte-identical tree on two sequential calls with no disk change', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const first = await orchestrator.preview({ projectRoot, selections: SELECTIONS });
    const second = await orchestrator.preview({ projectRoot, selections: SELECTIONS });

    const shape = (entries: typeof first.entries) =>
      entries.map((entry) => ({ path: entry.path, action: entry.action }));
    expect(shape(second.entries)).toEqual(shape(first.entries));
  });

  it('marks already-onboarded files skip with a numeric mtimeMs', async () => {
    const orchestrator = new OnboardingOrchestrator();
    await orchestrator.run({ projectRoot, selections: SELECTIONS });

    const result = await orchestrator.preview({ projectRoot, selections: SELECTIONS });

    // Every planned file now exists with identical bytes (auto-update) or is project-owned, so
    // nothing should be re-created or overwritten.
    expect(result.entries.some((entry) => entry.action === 'create')).toBe(false);
    expect(result.entries.some((entry) => entry.action === 'overwrite')).toBe(false);
    expect(result.entries.every((entry) => entry.action === 'skip')).toBe(true);
    for (const entry of result.entries) {
      expect(typeof entry.mtimeMs).toBe('number');
    }
  });

  it('marks a changed auto-update file overwrite and includes its mtimeMs', async () => {
    const orchestrator = new OnboardingOrchestrator();
    await orchestrator.run({ projectRoot, selections: SELECTIONS });

    // The silent-update hook is an auto-update artifact; mutate it so its bytes diverge.
    const hookPath = join(projectRoot, PATHS.HOOKS_SILENT_UPDATE);
    writeFileSync(hookPath, '# locally edited\n');

    const result = await orchestrator.preview({ projectRoot, selections: SELECTIONS });
    const hookEntry = result.entries.find((entry) => entry.path.endsWith('silent-update.sh'));

    expect(hookEntry?.action).toBe('overwrite');
    expect(typeof hookEntry?.mtimeMs).toBe('number');
    // The file we edited was not touched by the preview.
    expect(readFileSync(hookPath, 'utf8')).toBe('# locally edited\n');
  });

  it('throws ValidationError for a non-existent path and returns no partial result', async () => {
    const missing = join(projectRoot, 'does-not-exist');

    await expect(
      new OnboardingOrchestrator().preview({ projectRoot: missing, selections: SELECTIONS }),
    ).rejects.toMatchObject({
      name: 'ValidationError',
      code: 'VALIDATION_ERROR',
    });
  });

  it('throws ValidationError when the path is a file rather than a directory', async () => {
    const filePath = join(projectRoot, 'a-file.txt');
    writeFileSync(filePath, 'not a directory');

    const error = await new OnboardingOrchestrator()
      .preview({ projectRoot: filePath, selections: SELECTIONS })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when profile overrides make the profile invalid', async () => {
    await expect(
      new OnboardingOrchestrator().preview({
        projectRoot,
        selections: SELECTIONS,
        profileOverrides: {
          escalation: {
            destructive_operations: 'block',
            risky_migrations: 'warn',
            security_findings: 'block',
            db_row_threshold: 'bad-threshold' as never,
          },
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as optionalPackage from '@/core/optional-package.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { HealthChecker } from '@/health/checker.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';
import { RagService } from '@/rag/service.js';

vi.mock('@/core/optional-package.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/optional-package.js')>();
  return { ...actual, describeOptionalEngine: vi.fn(actual.describeOptionalEngine) };
});

let projectRoot: string;
let frameworkHome: string;
let savedFrameworkHome: string | undefined;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
}

async function onboard(): Promise<void> {
  await new OnboardingOrchestrator().run({
    projectRoot,
    selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
  });
}

function turnRagOnWithDefaultModel(): void {
  const profile = readProjectProfile(projectRoot)!;
  syncFrameworkConfig(projectRoot, {
    intelligence: { ...profile.intelligence, rag_enabled: true, embedding_provider: 'local' },
  });
  vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
    enabled: true,
    configured_provider: 'local',
    configured_model: 'Xenova/all-MiniLM-L6-v2',
    index_present: true,
    valid: true,
    chunk_count: 1,
    size_bytes: 128,
  });
}

function find(report: Awaited<ReturnType<HealthChecker['run']>>, name: string) {
  return report.checks.find((check) => check.name === name);
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-health-rag-plugin-'));
  frameworkHome = join(tmpdir(), `paqad-health-rag-home-${Date.now()}`);
  savedFrameworkHome = process.env.PAQAD_FRAMEWORK_HOME;
  process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectRoot, { recursive: true, force: true });
  if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
  rmSync(join(homedir(), '.paqad', 'models'), { recursive: true, force: true });
  if (savedFrameworkHome === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
  else process.env.PAQAD_FRAMEWORK_HOME = savedFrameworkHome;
});

describe('doctor RAG lines for a plugin install', () => {
  it('passes the model cache check when the default model sits in the home models folder', async () => {
    await onboard();
    turnRagOnWithDefaultModel();
    mkdirSync(join(homedir(), '.paqad', 'models', 'Xenova', 'all-MiniLM-L6-v2'), {
      recursive: true,
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(find(report, 'RAG model cache present')?.status).toBe('pass');
  });

  it('warns about the model cache when only another model is cached', async () => {
    await onboard();
    turnRagOnWithDefaultModel();
    mkdirSync(join(homedir(), '.paqad', 'models', 'Other', 'model'), { recursive: true });

    const report = await new HealthChecker().run(projectRoot);

    expect(find(report, 'RAG model cache present')?.status).toBe('warning');
  });

  it('starts the engine line with not ready: installing while the engine installs', async () => {
    await onboard();
    turnRagOnWithDefaultModel();
    vi.mocked(optionalPackage.describeOptionalEngine).mockReturnValue({ state: 'installing' });

    const report = await new HealthChecker().run(projectRoot);

    expect(find(report, 'RAG engine installed')?.detail.startsWith('not ready: installing')).toBe(
      true,
    );
  });

  it('reads the vectors folder as ignored after onboarding with RAG off and no vectors folder', async () => {
    git(['init', '-q']);
    await onboard();
    turnRagOnWithDefaultModel();
    expect(existsSync(join(projectRoot, '.paqad', 'vectors'))).toBe(false);

    const report = await new HealthChecker().run(projectRoot);

    expect(find(report, 'RAG vector gitignore present')?.status).toBe('pass');
  });
});

describe('doctor tracked session sentinels', () => {
  it('warns and gives the untrack command when git tracks a sentinel', async () => {
    git(['init', '-q']);
    await onboard();
    mkdirSync(join(projectRoot, '.paqad', '.agent-entry-loaded.d'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', '.agent-entry-loaded.d', 'session-1'), 'x');
    git(['add', '-f', '.paqad/.agent-entry-loaded.d/session-1']);

    const report = await new HealthChecker().run(projectRoot);
    const check = find(report, 'Session sentinels untracked');

    expect(check?.status).toBe('warning');
    expect(check?.remediation).toContain('git rm -r --cached .paqad/.agent-entry-loaded.d');
  });

  it('passes when git tracks no sentinel', async () => {
    git(['init', '-q']);
    await onboard();

    const report = await new HealthChecker().run(projectRoot);

    expect(find(report, 'Session sentinels untracked')?.status).toBe('pass');
  });
});

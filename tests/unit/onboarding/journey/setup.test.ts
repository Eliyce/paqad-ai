import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OnboardingOutput } from '../../../../src/core/types/onboarding.js';
import { readChoices } from '../../../../src/onboarding/journey/choices.js';
import {
  applySetupStage,
  gitWorkflowHashes,
  journeyHosts,
  setupOptions,
} from '../../../../src/onboarding/journey/setup.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';
import type { OnboardingOptions } from '../../../../src/onboarding/orchestrator.js';

import { at, clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

function output(
  files: string[],
  failures: OnboardingOutput['step_failures'] = [],
): OnboardingOutput {
  return {
    adapter: 'claude-code',
    decision_pause_supported_adapters: ['claude-code'],
    generated_files: files,
    detected_modules: [],
    runtime_root: '/opt/paqad/runtime',
    manifest_path: '.paqad/onboarding-manifest.json',
    warnings: [],
    kept_files: [],
    drift_review_targets: [],
    reverted_framework_values: [],
    step_failures: failures,
  };
}

describe('setup stage', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
    seedRun(root, {
      providers: ['claude-code', 'codex-cli'],
      detection: {
        stack: 'react',
        capabilities: ['vite'],
        source: 'detector',
        reason: 'x',
        detected_at: at(1),
      },
    });
    updateRun(root, (draft) => {
      draft.stages.detect = { status: 'done' };
      draft.stages.setup = { status: 'running', started_at: at(2) };
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('FR-15: runs the orchestrator non-interactively with search on and the index deferred', () => {
    const options = setupOptions(root, readRun(root)!);
    expect(options.interactive).toBe(false);
    expect(options.selections?.stack).toBe('react');
    expect(options.selections?.providers).toEqual(['claude-code', 'codex-cli']);
    expect(options.selections?.rag).toEqual({ enabled: true, provider: 'local', index: 'defer' });
  });

  it('FR-16: records written{} from generated_files and the git-workflow setup hashes', async () => {
    writeFile(root, 'CLAUDE.md', '# entry');
    writeFile(root, '.paqad/configs/git-workflow/branches.yaml', 'default_type: feat\n');
    let seen: OnboardingOptions | null = null;
    const runner = {
      run: async (options: OnboardingOptions) => {
        seen = options;
        return output([join(root, 'CLAUDE.md')]);
      },
    };
    const setup = await applySetupStage(root, { compileOnly: false, runner }, clockAt(3));
    expect(seen).not.toBeNull();
    expect(setup.generated_files).toEqual(['CLAUDE.md']);
    const run = readRun(root)!;
    expect(Object.keys(run.written)).toEqual(['CLAUDE.md']);
    expect(Object.keys(run.setup_hashes)).toEqual(['.paqad/configs/git-workflow/branches.yaml']);
    expect(readChoices(root).some((row) => row.kind === 'rag')).toBe(true);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# entry');
  });

  it('carries structured step failures so the end gate can refuse', async () => {
    const runner = {
      run: async () => output([], [{ step: 'planning_rules', message: 'bad yaml' }]),
    };
    const setup = await applySetupStage(root, { compileOnly: false, runner }, clockAt(3));
    expect(setup.step_failures).toEqual([{ step: 'planning_rules', message: 'bad yaml' }]);
  });

  it('refuses before step 2 is started and refuses --compile-only before a setup', async () => {
    const runner = { run: async () => output([]) };
    await expect(applySetupStage(root, { compileOnly: true, runner }, clockAt(3))).rejects.toThrow(
      'before --compile-only',
    );
    updateRun(root, (draft) => void (draft.stages.setup = { status: 'not_started' }));
    await expect(applySetupStage(root, { compileOnly: false, runner }, clockAt(3))).rejects.toThrow(
      'Start step 2',
    );
  });

  it('FR-16: keeps relative generated paths, skips a file that is gone and defaults step failures', async () => {
    writeFile(root, 'docs/a.md', 'a');
    const runner = {
      run: async () => {
        const out = output(['docs/a.md', 'docs\\gone.md']);
        delete (out as Partial<OnboardingOutput>).step_failures;
        return out;
      },
    };
    const setup = await applySetupStage(root, { compileOnly: false, runner }, clockAt(3));
    expect(setup.generated_files).toEqual(['docs/a.md', 'docs/gone.md']);
    expect(setup.step_failures).toEqual([]);
    expect(Object.keys(readRun(root)!.written)).toEqual(['docs/a.md']);
  });

  it('hashes git-workflow files in nested folders and skips what is not a plain file', () => {
    writeFile(root, '.paqad/configs/git-workflow/branches.yaml', 'a');
    writeFile(root, '.paqad/configs/git-workflow/hooks/commit.yaml', 'b');
    mkdirSync(join(root, '.paqad/configs/git-workflow/empty'));
    symlinkSync('/dev/null', join(root, '.paqad/configs/git-workflow/device-link'));
    expect(Object.keys(gitWorkflowHashes(root)).sort()).toEqual([
      '.paqad/configs/git-workflow/branches.yaml',
      '.paqad/configs/git-workflow/hooks/commit.yaml',
    ]);
  });

  it('refuses setup options with no stack and sets the content domain for a content stack', () => {
    const run = readRun(root)!;
    expect(() => setupOptions(root, { ...run, detection: undefined })).toThrow(
      'Step 1 (Read your project) has no stack recorded.',
    );
    const content = setupOptions(root, {
      ...run,
      detection: { ...run.detection!, stack: 'short-video', capabilities: [] },
    });
    expect(content.selections?.domain).toBe('content');
    expect(setupOptions(root, run).selections?.domain).toBe('coding');
  });

  it('--compile-only re-runs the rule compile and keeps the earlier setup files', async () => {
    const runner = { run: async () => output(['CLAUDE.md']) };
    writeFile(root, 'CLAUDE.md', '# entry');
    await applySetupStage(root, { compileOnly: false, runner }, clockAt(3));
    const again = await applySetupStage(root, { compileOnly: true, runner }, clockAt(4));
    expect(again.completed_at).toBe(at(4));
    expect(again.generated_files).toEqual(['CLAUDE.md']);
    expect(Array.isArray(again.step_failures)).toBe(true);
    expect(readRun(root)!.setup?.completed_at).toBe(at(4));
  });

  it('AC-17 FR-28: only ticked hosts with a skills folder run the journey', () => {
    expect(
      journeyHosts([
        'claude-code',
        'codex-cli',
        'aider',
        'github-copilot',
        'junie',
        'aiassistant',
        'cursor',
      ]),
    ).toEqual(['claude-code', 'codex-cli', 'cursor']);
  });
});

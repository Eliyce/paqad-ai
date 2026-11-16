import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OnboardingOutput } from '../../../../src/core/types/onboarding.js';
import { readChoices } from '../../../../src/onboarding/journey/choices.js';
import {
  applySetupStage,
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

import { readdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { AdapterType } from '@/core/types/adapter.js';
import { DOMAIN_STACK_MAP, type Capability, type Stack } from '@/core/types/domain.js';
import type { OnboardingOutput } from '@/core/types/onboarding.js';
import { compileOnboardingRules, type OnboardingOptions } from '@/onboarding/orchestrator.js';

import { appendChoice } from './choices.js';
import { JourneyRefusal } from './errors.js';
import { fileSha256 } from './preflight.js';
import { requireRun, updateRun } from './run-store.js';
import type { JourneyRun, SetupRecord } from './types.js';

export const HOSTS_WITHOUT_SKILLS: readonly string[] = [
  'aider',
  'github-copilot',
  'junie',
  'aiassistant',
];

export function journeyHosts(providers: readonly string[]): string[] {
  return providers.filter((provider) => !HOSTS_WITHOUT_SKILLS.includes(provider));
}

export interface SetupRunner {
  run(options: OnboardingOptions): Promise<OnboardingOutput>;
}

export interface SetupStageResult {
  setup: SetupRecord;
  written: Record<string, string>;
  setup_hashes: Record<string, string>;
}

function toRelative(projectRoot: string, path: string): string {
  return (isAbsolute(path) ? relative(projectRoot, path) : path).split('\\').join('/');
}

function listFiles(root: string, rel: string): string[] {
  try {
    return readdirSync(join(root, rel), { withFileTypes: true }).flatMap((entry) => {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) return listFiles(root, child);
      return entry.isFile() ? [child] : [];
    });
  } catch {
    return [];
  }
}

export function gitWorkflowHashes(projectRoot: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const rel of listFiles(projectRoot, PATHS.GIT_WORKFLOW_DIR)) {
    const hash = fileSha256(join(projectRoot, rel));
    if (hash) hashes[rel] = hash;
  }
  return hashes;
}

export function setupOptions(projectRoot: string, run: JourneyRun): OnboardingOptions {
  const detection = run.detection;
  if (!detection) throw new JourneyRefusal('Step 1 (Read your project) has no stack recorded.');
  const stack = detection.stack as Stack;
  const domain = DOMAIN_STACK_MAP.content.includes(stack) ? 'content' : 'coding';
  const providers = run.providers as AdapterType[];
  return {
    projectRoot,
    interactive: false,
    adapters: providers,
    selections: {
      providers,
      domain,
      stack,
      capabilities: detection.capabilities as Capability[],
      rag: { enabled: true, provider: 'local', index: 'defer' },
    },
  };
}

function hashWritten(projectRoot: string, files: readonly string[]): Record<string, string> {
  const written: Record<string, string> = {};
  for (const file of files) {
    const hash = fileSha256(join(projectRoot, file));
    if (hash) written[file] = hash;
  }
  return written;
}

export async function runSetupStage(
  projectRoot: string,
  run: JourneyRun,
  runner: SetupRunner,
  now: () => Date,
): Promise<SetupStageResult> {
  const output = await runner.run(setupOptions(projectRoot, run));
  const generated = output.generated_files.map((file) => toRelative(projectRoot, file));
  return {
    setup: {
      completed_at: now().toISOString(),
      generated_files: generated,
      step_failures: output.step_failures ?? [],
      rag: 'deferred',
    },
    written: hashWritten(projectRoot, generated),
    setup_hashes: gitWorkflowHashes(projectRoot),
  };
}

export async function recompileSetup(
  projectRoot: string,
  run: JourneyRun,
  now: () => Date,
): Promise<SetupRecord> {
  if (!run.setup) {
    throw new JourneyRefusal('Run `paqad-ai onboarding setup` before --compile-only.');
  }
  const compiled = await compileOnboardingRules(projectRoot);
  return {
    ...run.setup,
    completed_at: now().toISOString(),
    step_failures: compiled.step_failures,
  };
}

export async function applySetupStage(
  projectRoot: string,
  input: { compileOnly: boolean; runner: SetupRunner },
  now: () => Date,
): Promise<SetupRecord> {
  const run = requireRun(projectRoot);
  if (run.stages.setup.status !== 'running') {
    throw new JourneyRefusal('Start step 2 first: `paqad-ai onboarding stage start setup`.');
  }
  if (input.compileOnly) {
    const setup = await recompileSetup(projectRoot, run, now);
    updateRun(projectRoot, (draft) => void (draft.setup = setup), { now });
    return setup;
  }
  const result = await runSetupStage(projectRoot, run, input.runner, now);
  updateRun(
    projectRoot,
    (draft) => {
      draft.setup = result.setup;
      draft.written = { ...draft.written, ...result.written };
      draft.setup_hashes = result.setup_hashes;
    },
    { now },
  );
  appendChoice(projectRoot, {
    ts: result.setup.completed_at,
    run_id: run.run_id,
    stage: 'setup',
    kind: 'rag',
    choice: 'search on with the local provider; the index is built at Wrap up',
    reason: 'the journey turns search on by default',
    by: 'paqad-onboarding',
  });
  return result.setup;
}

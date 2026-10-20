import { createDeliveryShell } from '@/delivery/shell.js';
import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { engineLog } from '@/core/logger-registry.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { readGitStatusFiles } from '@/pipeline/change-evidence.js';
import { digestFile } from '@/pipeline/dirty-baseline.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { MutationResult } from '@/core/types/mutation.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { Lane } from '@/core/types/routing.js';
import type { VerificationOrigin } from '@/core/types/verification.js';

import { resolveMutationMode, type MutationMode } from './mode.js';
import {
  runMutationGate,
  skippedMutationResult,
  type MutationRunnerDeps,
  type RunMutationGateOptions,
} from './runner.js';
import { scopeMutationTargets } from './scope.js';

export const MUTATION_ORIGINS: ReadonlySet<VerificationOrigin> = new Set([
  'ci-backstop',
  'git-backstop',
]);

export const MUTATION_OFF_NOTE = 'Mutation testing is off (mutation_mode is off).';

export function mutationSeamNote(mode: MutationMode): string {
  return `Mutation testing runs only on CI and pre-push (mutation_mode is ${mode}).`;
}

export type MutationProfileFacts = Pick<ProjectProfile, 'commands' | 'stack_profile'>;

export interface BackstopMutationDeps {
  resolveMode?: (projectRoot: string) => MutationMode;
  readProfile?: (projectRoot: string) => MutationProfileFacts | null;
  detectStackProfile?: (projectRoot: string) => Promise<DetectedStackProfile | null>;
  runTestCommand?: (command: string, projectRoot: string) => Promise<{ exitCode: number }>;
  runMutation?: (options: RunMutationGateOptions) => Promise<MutationResult>;
  snapshotTree?: (projectRoot: string) => Promise<string>;
  runner?: MutationRunnerDeps;
}

export interface RunBackstopMutationOptions {
  projectRoot: string;
  origin: Extract<VerificationOrigin, 'hook-completion' | 'git-backstop' | 'ci-backstop'>;
  changedFiles: string[];
  lane: Lane;
  deps?: BackstopMutationDeps;
}

export interface BackstopMutationOutcome {
  mutation_result?: MutationResult;
  mutation_note?: string;
  mutation_strict?: boolean;
}

export async function runBackstopMutation(
  options: RunBackstopMutationOptions,
): Promise<BackstopMutationOutcome> {
  const { projectRoot, origin, changedFiles, lane } = options;
  const deps = options.deps ?? {};

  const mode = (deps.resolveMode ?? resolveMutationMode)(projectRoot);
  if (mode === 'off') {
    return { mutation_note: MUTATION_OFF_NOTE };
  }
  if (!MUTATION_ORIGINS.has(origin)) {
    return { mutation_note: mutationSeamNote(mode) };
  }

  const strict = mode === 'strict';
  let stackProfile: DetectedStackProfile | null = null;
  try {
    const profile = (deps.readProfile ?? defaultReadProfile)(projectRoot);
    stackProfile =
      profile?.stack_profile ??
      (await (deps.detectStackProfile ?? defaultDetectStackProfile)(projectRoot));

    if (lane === 'fast') {
      return planted(skippedMutationResult(stackProfile, 'fast-lane'), strict);
    }
    if (scopeMutationTargets(changedFiles).length === 0) {
      return planted(skippedMutationResult(stackProfile, 'no-changed-code'), strict);
    }

    const testCommand = profile?.commands?.test?.trim() ?? '';
    if (testCommand.length === 0) {
      return planted(skippedMutationResult(stackProfile, 'no-test-command'), strict);
    }
    const testRun = await (deps.runTestCommand ?? defaultRunTestCommand)(testCommand, projectRoot);
    if (testRun.exitCode !== 0) {
      engineLog(
        'warn',
        `paqad: mutation testing did not run, the test command exited ${testRun.exitCode}`,
      );
      return planted(skippedMutationResult(stackProfile, 'tests-not-green'), strict);
    }

    const snapshotTree = deps.snapshotTree ?? defaultSnapshotTree;
    const before = await snapshotTree(projectRoot);
    const runnerDeps: MutationRunnerDeps = {
      isTreeClean: async (root) => (await snapshotTree(root)) === before,
      ...deps.runner,
    };

    const result = await (deps.runMutation ?? runMutationGate)({
      projectRoot,
      changedFiles,
      lane,
      stackProfile,
      testsGreen: true,
      deps: runnerDeps,
    });
    return planted(result, strict);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engineLog('warn', `paqad: mutation testing did not run (${message})`);
    return planted(skippedMutationResult(stackProfile, 'run-failed'), strict);
  }
}

function planted(result: MutationResult, strict: boolean): BackstopMutationOutcome {
  return { mutation_result: result, mutation_strict: strict };
}

function defaultReadProfile(projectRoot: string): MutationProfileFacts | null {
  return readProjectProfile(projectRoot, { persistMigration: false });
}

async function defaultDetectStackProfile(projectRoot: string): Promise<DetectedStackProfile> {
  return (await new StackIntrospector().snapshot(projectRoot, { persist: false })).profile;
}

async function defaultRunTestCommand(
  command: string,
  projectRoot: string,
): Promise<{ exitCode: number }> {
  const parsed = parseCommandChain(command);
  if (!parsed.ok) {
    engineLog(
      'warn',
      `paqad: unsupported shell syntax in the test command: ${parsed.invalidToken}`,
    );
    return { exitCode: 1 };
  }
  const result = await runCommandChain(createDeliveryShell(projectRoot), parsed.steps, projectRoot);
  return { exitCode: result.exitCode };
}

async function defaultSnapshotTree(projectRoot: string): Promise<string> {
  const files = await readGitStatusFiles(projectRoot);
  return JSON.stringify(
    [...files].sort().map((relativePath) => [relativePath, digestFile(projectRoot, relativePath)]),
  );
}

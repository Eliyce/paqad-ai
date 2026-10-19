// Mutation testing at the backstop seam (issue #293, Option A).
//
// `runMutationGate` is called from exactly one place: repository verification, through this
// helper. What it does depends on `mutation_mode` (team floored, default off) and the origin:
//
//   - mode off (or the key absent): nothing runs, no mutation_result, and the gate reads not
//     required with "mutation_mode is off".
//   - the `hook-completion` origin (the per-turn end of an agent turn): nothing runs, whatever the
//     mode, so the turn stays fast (decision D-01M5AM6S3Z36HR2NRKN2XYNZWW, INV-7). The gate reads
//     not required and says it runs on CI and pre-push only.
//   - `ci-backstop` / `git-backstop` with warn or strict: the project's own test command runs first
//     (the green-suite signal). No command, or a red one, reads did not run and the mutation tool
//     never starts. A green run threads the detected stack profile into `runMutationGate`.
//
// Those two origins fire only when a project calls runtime/scripts/verify-backstop.mjs from its own
// CI or pre-push hook; paqad installs neither, so mutation is opt-in twice over. Every external
// effect is injectable so tests never spawn a real tool, and nothing here throws: a fault records a
// `run-failed` skip, which the gate reads as did not run.

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

/** The only origins mutation ever runs on. Never `hook-completion`, never a per-edit seam. */
export const MUTATION_ORIGINS: ReadonlySet<VerificationOrigin> = new Set([
  'ci-backstop',
  'git-backstop',
]);

/** The gate detail when mutation_mode is off (or no surface sets it). */
export const MUTATION_OFF_NOTE = 'Mutation testing is off (mutation_mode is off).';

/** The gate detail on an origin mutation never runs on (the end of an agent turn). */
export function mutationSeamNote(mode: MutationMode): string {
  return `Mutation testing runs only on CI and pre-push (mutation_mode is ${mode}).`;
}

/** The parts of the project profile this seam reads: the test command and the detected stack. */
export type MutationProfileFacts = Pick<ProjectProfile, 'commands' | 'stack_profile'>;

export interface BackstopMutationDeps {
  /** Resolve the floored `mutation_mode`. Default: {@link resolveMutationMode}. */
  resolveMode?: (projectRoot: string) => MutationMode;
  /** Read the project profile (test command + detected stack). Default: no migration write. */
  readProfile?: (projectRoot: string) => MutationProfileFacts | null;
  /** Detect the stack when the profile carries none. Default: a read-only stack snapshot. */
  detectStackProfile?: (projectRoot: string) => Promise<DetectedStackProfile | null>;
  /** Run the project test command. Default: the same argv-chain runner `paqad-ai checks` uses. */
  runTestCommand?: (command: string, projectRoot: string) => Promise<{ exitCode: number }>;
  /** Run the mutation gate. Default: {@link runMutationGate}. */
  runMutation?: (options: RunMutationGateOptions) => Promise<MutationResult>;
  /** Fingerprint the working tree, to tell whether the mutation run changed it. */
  snapshotTree?: (projectRoot: string) => Promise<string>;
  /** Deps handed to the runner (tool detection, execution, report parsing, tree check). */
  runner?: MutationRunnerDeps;
}

export interface RunBackstopMutationOptions {
  projectRoot: string;
  origin: Extract<VerificationOrigin, 'hook-completion' | 'git-backstop' | 'ci-backstop'>;
  changedFiles: string[];
  lane: Lane;
  deps?: BackstopMutationDeps;
}

/** What the backstop plants on the verification context. Keys are absent when not set. */
export interface BackstopMutationOutcome {
  mutation_result?: MutationResult;
  mutation_note?: string;
  mutation_strict?: boolean;
}

/**
 * Decide whether mutation runs for this verification and, when it does, run it. Never throws.
 */
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

    // The runner's own before-the-suite skips, decided here so the suite never runs for nothing.
    if (lane === 'fast') {
      return planted(skippedMutationResult(stackProfile, 'fast-lane'), strict);
    }
    if (scopeMutationTargets(changedFiles).length === 0) {
      return planted(skippedMutationResult(stackProfile, 'no-changed-code'), strict);
    }

    // The green-suite signal: the project's own test command, run first.
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

    // A dirty tree before the run (an uncommitted edit at pre-push) is not the run's doing: the
    // tree counts as clean when the mutation run left it exactly as it found it.
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

/** Run the test command as `paqad-ai checks` does: an `&&` argv chain, never a shell. */
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

/** Every dirty path with the digest of its bytes, so a change inside an already-dirty file shows. */
async function defaultSnapshotTree(projectRoot: string): Promise<string> {
  const files = await readGitStatusFiles(projectRoot);
  return JSON.stringify(
    [...files].sort().map((relativePath) => [relativePath, digestFile(projectRoot, relativePath)]),
  );
}

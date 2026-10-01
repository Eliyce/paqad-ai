import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';

import { FrameworkError } from '@/core/errors/index.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { ProjectCommands } from '@/core/types/project-profile.js';

import { OnboardingOrchestrator } from './orchestrator.js';
import type { RagSelection } from './rag-onboarding.js';

/**
 * The creation-time "no stack chosen yet" marker (ENT-01/02, INV-5).
 *
 * This is deliberately NOT a member of the `Stack` enum: a created workspace is a
 * development bootstrap, not a detected project, so it must never flow into the
 * stack-detection path that would silently apply a framework's default commands
 * (the pnpm/react defaults). It is a state the result reports, nothing more.
 */
export const UNDECIDED_STACK = 'undecided' as const;

/**
 * An empty stack profile. Passing this as both the onboarding `selections.stack_profile`
 * and `profileOverrides.stack_profile` keeps `buildProjectProfile`'s `stack_profile` empty,
 * so a freshly created project records no framework (AC-4, INV-5).
 */
export const EMPTY_STACK_PROFILE: DetectedStackProfile = {
  frameworks: [],
  traits: [],
  toolchains: [],
  version_bands: [],
  sources: [],
};

/**
 * The placeholder command set a created-but-undecided workspace records (the ENT-02
 * guarantee). Every command is a self-explaining no-op rather than a framework default
 * (pnpm/react/…): there is no stack yet, so there is nothing real to run. Passing these
 * as `profileOverrides.commands` makes `buildProjectProfile` use them verbatim instead of
 * deriving framework commands from a (here empty) stack profile.
 */
export const UNDECIDED_COMMANDS: ProjectCommands = {
  install: undecidedPlaceholder(),
  dev: undecidedPlaceholder(),
  test: undecidedPlaceholder(),
  test_single: undecidedPlaceholder(),
  lint: undecidedPlaceholder(),
  format: undecidedPlaceholder(),
  migrate: undecidedPlaceholder(),
  build: undecidedPlaceholder(),
};

function undecidedPlaceholder(): string {
  return 'echo "choose an application stack first (paqad discovery / onboard)"';
}

export interface CreateProjectOptions {
  /** The workspace name; also the created directory name under `parentDir`. */
  name: string;
  /** Parent directory the workspace is created in. Defaults to `process.cwd()`. */
  parentDir?: string;
  /** AI providers to onboard. Defaults to `['claude-code']`. */
  providers?: AdapterType[];
  /** Optional RAG opt-in forwarded to onboarding. Omitted ⇒ RAG is left off. */
  rag?: RagSelection;
  /** Overwrite a non-empty, non-paqad directory instead of refusing (ENT-03 escape hatch). */
  force?: boolean;
}

export interface CreateProjectResult {
  /** Absolute path to the created workspace. */
  projectRoot: string;
  /** `true` when the directory did not exist before this call. */
  created: boolean;
  /** `true` when this call ran `git init` (false when already inside a work tree or on failure). */
  gitInitialized: boolean;
  /** Always `'undecided'`: creation never selects an application stack. */
  stack: typeof UNDECIDED_STACK;
  /** POSIX-relative paths onboarding wrote. */
  generatedFiles: string[];
  /** Pre-existing top-level entries that were left untouched (rerun/resume). */
  preserved: string[];
  /** A recoverable, non-fatal issue (e.g. a git failure) the owner should know about. */
  recovery?: string;
}

/**
 * Create a development workspace with an UNDECIDED application stack (Slice 3, ENT foundation).
 *
 * This is additive: it reuses {@link OnboardingOrchestrator.run} end-to-end and never touches
 * the existing `onboard`/`install`/`update` paths (INV-4). The only new behavior is the thin
 * wrapper — directory creation, the safe non-empty guard (ENT-03), optional `git init` (FR-8),
 * and the undecided-stack handoff (INV-5) — around that reused run.
 */
export async function createProjectWorkspace(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const parentDir = options.parentDir ?? process.cwd();
  const projectRoot = join(parentDir, options.name);
  const providers: AdapterType[] =
    options.providers && options.providers.length > 0 ? options.providers : ['claude-code'];

  // ENT-03 — decide, BEFORE any write, whether this directory is safe to create into.
  const preExisted = existsSync(projectRoot);
  const existingEntries = preExisted ? readdirSync(projectRoot) : [];
  const isNonEmpty = existingEntries.length > 0;
  const hasPaqad = preExisted && existsSync(join(projectRoot, '.paqad'));

  // A non-empty directory that is NOT a prior paqad workspace is the owner's work: refuse to
  // clobber it (and write nothing) unless they opt in with `force`. A directory that already
  // carries `.paqad/` is a rerun/resume — the orchestrator's own checkpoint handles the
  // remainder — so continue. An empty directory is always safe.
  if (isNonEmpty && !hasPaqad && !options.force) {
    throw new FrameworkError(
      `Refusing to create a workspace in a non-empty directory: ${projectRoot}. ` +
        `Preserve your work — pass --force to overwrite it, or choose an empty directory.`,
      { code: 'PROJECT_DIR_NOT_EMPTY', details: { projectRoot: toPosixPath(projectRoot) } },
    );
  }

  mkdirSync(projectRoot, { recursive: true });

  // FR-8 — initialize git only when the directory is not already inside a work tree, so an
  // existing repo (e.g. creating into a subfolder of one) is preserved. A git failure is
  // recoverable, not fatal: creation still succeeds and the issue is surfaced in `recovery`.
  let gitInitialized = false;
  let recovery: string | undefined;
  if (!(await isInsideGitWorkTree(projectRoot))) {
    try {
      await execa('git', ['init'], { cwd: projectRoot });
      gitInitialized = true;
    } catch (error) {
      recovery = `git init failed (${errorMessage(error)}); initialize version control yourself.`;
    }
  }

  // FR-3/FR-9 — reuse full onboarding. The empty `selections.stack_profile` keeps the derived
  // profile free of any framework, and `profileOverrides.commands` pins the undecided
  // placeholders in place of framework defaults (INV-5, AC-4). No second onboarding path.
  const output = await new OnboardingOrchestrator().run({
    projectRoot,
    selections: {
      stack_profile: EMPTY_STACK_PROFILE,
      domain: 'coding',
      providers,
      rag: options.rag,
    },
    profileOverrides: {
      project: {
        name: options.name,
        id: slugify(options.name),
        description: 'Created by paqad-ai new project',
      },
      commands: UNDECIDED_COMMANDS,
      stack_profile: EMPTY_STACK_PROFILE,
    },
  });

  return {
    projectRoot,
    created: !preExisted,
    gitInitialized,
    stack: UNDECIDED_STACK,
    generatedFiles: output.generated_files,
    preserved: existingEntries,
    ...(recovery ? { recovery } : {}),
  };
}

/**
 * True when `projectRoot` already sits inside a git work tree. A non-git directory makes
 * `git rev-parse` exit non-zero, which `reject: false` turns into a clean negative rather
 * than a throw, so a missing or failing git simply means "not inside a work tree".
 */
async function isInsideGitWorkTree(projectRoot: string): Promise<boolean> {
  try {
    const result = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      reject: false,
    });
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Project id slug: lowercase, non-alphanumerics collapsed to single dashes, trimmed. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'paqad-project';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

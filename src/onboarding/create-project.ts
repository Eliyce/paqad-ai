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

export const UNDECIDED_STACK = 'undecided' as const;

export const EMPTY_STACK_PROFILE: DetectedStackProfile = {
  frameworks: [],
  traits: [],
  toolchains: [],
  version_bands: [],
  sources: [],
};

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

export const UNDECIDED_COMMAND_PREFIX = 'echo "choose an application stack';

export function isUndecidedCommand(command: string | undefined): boolean {
  return typeof command === 'string' && command.trim().startsWith(UNDECIDED_COMMAND_PREFIX);
}

export function isUndecidedCommands(commands: Partial<ProjectCommands> | undefined): boolean {
  if (!commands) {
    return false;
  }
  return [commands.dev, commands.build, commands.test].some((command) =>
    isUndecidedCommand(command),
  );
}

export interface CreateProjectOptions {
  name: string;
  parentDir?: string;
  providers?: AdapterType[];
  rag?: RagSelection;
  force?: boolean;
}

export interface CreateProjectResult {
  projectRoot: string;
  created: boolean;
  gitInitialized: boolean;
  stack: typeof UNDECIDED_STACK;
  generatedFiles: string[];
  preserved: string[];
  recovery?: string;
}

export async function createProjectWorkspace(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const parentDir = options.parentDir ?? process.cwd();
  const projectRoot = join(parentDir, options.name);
  const providers: AdapterType[] =
    options.providers && options.providers.length > 0 ? options.providers : ['claude-code'];

  const preExisted = existsSync(projectRoot);
  const existingEntries = preExisted ? readdirSync(projectRoot) : [];
  const isNonEmpty = existingEntries.length > 0;
  const hasPaqad = preExisted && existsSync(join(projectRoot, '.paqad'));

  if (isNonEmpty && !hasPaqad && !options.force) {
    throw new FrameworkError(
      `Refusing to create a workspace in a non-empty directory: ${projectRoot}. ` +
        `Preserve your work — pass --force to overwrite it, or choose an empty directory.`,
      { code: 'PROJECT_DIR_NOT_EMPTY', details: { projectRoot: toPosixPath(projectRoot) } },
    );
  }

  mkdirSync(projectRoot, { recursive: true });

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

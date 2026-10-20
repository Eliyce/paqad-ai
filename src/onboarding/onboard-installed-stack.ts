import { StackIntrospector } from '@/introspection/stack-introspector.js';

import { FrameworkError } from '@/core/errors/index.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { AdapterType } from '@/core/types/adapter.js';

import { isUndecidedCommands } from './create-project.js';
import { readExistingOnboardingManifest } from './manifest-writer.js';
import { OnboardingOrchestrator } from './orchestrator.js';
import { verifyReadinessToDevelop, type ReadinessResult } from './readiness.js';

export interface OnboardInstalledStackOptions {
  projectRoot?: string;
  providers?: AdapterType[];
}

export interface OnboardInstalledStackResult {
  projectRoot: string;
  onboarded: boolean;
  detectedFrameworks: string[];
  providers: AdapterType[];
  commandsRederived: boolean;
  readiness: ReadinessResult;
  recovery?: string;
}

export async function onboardInstalledStack(
  options: OnboardInstalledStackOptions = {},
): Promise<OnboardInstalledStackResult> {
  const projectRoot = options.projectRoot ?? process.cwd();

  const existingProfile = readProjectProfile(projectRoot, { persistMigration: false });
  if (!existingProfile) {
    throw new FrameworkError(
      `No paqad workspace at ${projectRoot}. Create one first with ` +
        `\`paqad-ai new project <name>\` (or onboard an existing project with \`paqad-ai onboard\`).`,
      { code: 'WORKSPACE_NOT_FOUND', details: { projectRoot } },
    );
  }

  const detected = await new StackIntrospector().snapshot(projectRoot, { persist: false });
  const detectedFrameworks = detected.profile.frameworks;

  const providers = resolveProviders(projectRoot, options.providers);
  const readinessBefore = verifyReadinessToDevelop(projectRoot);

  if (detectedFrameworks.length === 0) {
    return {
      projectRoot,
      onboarded: false,
      detectedFrameworks: [],
      providers,
      commandsRederived: false,
      readiness: readinessBefore,
      recovery:
        'No application framework detected yet. Install your stack with the official installers ' +
        'the setup plan records (`paqad-ai setup plan show`), then re-run `paqad-ai setup onboard`.',
    };
  }

  const commandsRederived = isUndecidedCommands(existingProfile.commands);

  await new OnboardingOrchestrator().run({
    projectRoot,
    adapters: providers,
    selections: {
      providers,
      stack_profile: detected.profile,
      domain: 'coding',
    },
    ...(commandsRederived ? { profileOverrides: { commands: undefined } } : {}),
  });

  return {
    projectRoot,
    onboarded: true,
    detectedFrameworks,
    providers,
    commandsRederived,
    readiness: verifyReadinessToDevelop(projectRoot),
  };
}

function resolveProviders(projectRoot: string, explicit: AdapterType[] | undefined): AdapterType[] {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const manifest = readExistingOnboardingManifest(projectRoot);
  return manifest ? [manifest.adapter] : ['claude-code'];
}

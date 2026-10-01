import { StackIntrospector } from '@/introspection/stack-introspector.js';

import { FrameworkError } from '@/core/errors/index.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { AdapterType } from '@/core/types/adapter.js';

import { isUndecidedCommands } from './create-project.js';
import { readExistingOnboardingManifest } from './manifest-writer.js';
import { OnboardingOrchestrator } from './orchestrator.js';
import { verifyReadinessToDevelop, type ReadinessResult } from './readiness.js';

/**
 * SET-03 / SET-05 (#596 Slice 3) — onboard the *actual* installed stack of a workspace that
 * `paqad-ai new project` created with an undecided application stack.
 *
 * `createProjectWorkspace` deliberately pins the {@link UNDECIDED_COMMANDS} placeholders instead
 * of a framework default (ENT-02). A plain `paqad-ai onboard` re-run can NOT lift that state,
 * because onboarding's config-preservation carries the existing (undecided) commands forward
 * (`buildProjectProfile`: `overrides?.commands ?? derived`). This function is the missing handoff:
 * once the owner has installed their stack with the official installers the setup plan records,
 * it detects that stack and re-derives real commands from it — but only when an application
 * framework is actually present, so an empty workspace is never silently given a framework
 * default (ENT-02, SET-03 "an empty bootstrap is not full application onboarding").
 *
 * It is pure reuse: the onboarding engine ({@link OnboardingOrchestrator.run}) is driven, not
 * modified (INV-4), and its existing config-preservation + entry-file skip-if-present behaviour
 * preserves every team-owned setting on the re-run (INV-6 / SET-05).
 */

export interface OnboardInstalledStackOptions {
  /** Workspace root. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /**
   * Providers to onboard. Defaults to the provider recorded for the workspace (the onboarding
   * manifest's adapter), falling back to `claude-code`. Passing providers never removes another
   * provider's files — onboarding only writes, and entry files are skip-if-present.
   */
  providers?: AdapterType[];
}

export interface OnboardInstalledStackResult {
  projectRoot: string;
  /** `true` when a stack was detected and full onboarding ran; `false` when it was refused. */
  onboarded: boolean;
  /** The application frameworks detected on disk (empty when none were found). */
  detectedFrameworks: string[];
  /** The providers onboarding was run for. */
  providers: AdapterType[];
  /**
   * `true` when the workspace was still undecided and its commands were re-derived from the
   * detected stack; `false` when real commands were already present and left untouched (SET-05).
   */
  commandsRederived: boolean;
  /** Readiness verdict after the run (SET-04). Reported honestly — a bootstrap may still be unready. */
  readiness: ReadinessResult;
  /** A recoverable next action the owner should take (set when `onboarded` is `false`). */
  recovery?: string;
}

export async function onboardInstalledStack(
  options: OnboardInstalledStackOptions = {},
): Promise<OnboardInstalledStackResult> {
  const projectRoot = options.projectRoot ?? process.cwd();

  // The workspace must already exist (created by `new project` or a prior onboard). Re-onboarding
  // a stack into a directory that was never bootstrapped is a different, unsupported operation.
  const existingProfile = readProjectProfile(projectRoot, { persistMigration: false });
  if (!existingProfile) {
    throw new FrameworkError(
      `No paqad workspace at ${projectRoot}. Create one first with ` +
        `\`paqad-ai new project <name>\` (or onboard an existing project with \`paqad-ai onboard\`).`,
      { code: 'WORKSPACE_NOT_FOUND', details: { projectRoot } },
    );
  }

  // Detect the installed stack exactly as onboarding does, so the gate below matches what the
  // orchestrator would derive. A framework must be present: with none, `getPrimaryStack` falls
  // back to a default (laravel) and `buildDefaultCommands` would hand an empty workspace wrong
  // commands — the ENT-02 / SET-03 failure. So refuse rather than derive.
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

  // Re-derive commands only when the workspace is still undecided. When real commands already
  // exist (a team's customization, or a prior onboard), leave them untouched so the re-run is a
  // refresh, not a reset (SET-05). Passing `commands: undefined` makes the merge drop the stale
  // placeholders so `buildProjectProfile` falls back to the detection-derived commands.
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

/**
 * Recover the providers to re-onboard: an explicit caller list, else the provider recorded in the
 * onboarding manifest, else `claude-code`. Passing providers to the orchestrator also keeps its
 * selection resolution non-interactive (full overrides), so this never prompts.
 */
function resolveProviders(projectRoot: string, explicit: AdapterType[] | undefined): AdapterType[] {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const manifest = readExistingOnboardingManifest(projectRoot);
  return manifest ? [manifest.adapter] : ['claude-code'];
}

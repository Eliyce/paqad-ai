import { checkbox, select } from '@inquirer/prompts';

import {
  buildDetectedStackProfile,
  getPrimaryStack,
  summarizeStack,
} from '@/core/stack-profile.js';
import type { AdapterType } from '@/core/types/adapter.js';
import {
  DOMAIN_STACK_MAP,
  STACK_CAPABILITIES_MAP,
  type Capability,
  type Domain,
  type Stack,
} from '@/core/types/domain.js';
import type { DetectionReport } from '@/core/types/health.js';
import type {
  DetectedStackProfile,
  InstalledPackage,
  ToolchainInfo,
} from '@/core/types/introspection.js';

export interface OnboardingSelections {
  providers: AdapterType[];
  domain: Domain;
  stack_profile: DetectedStackProfile;
  stack?: Stack;
  capabilities?: string[];
}

type Frontend = 'none' | 'react' | 'vue';
type ReactStackCapability = 'next' | 'remix' | 'vite-spa' | 'gatsby';
type VueStackCapability = 'nuxt' | 'vite-spa' | 'quasar';

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

type SnapshotContext = {
  toolchains: ToolchainInfo[];
  packages: InstalledPackage[];
  profile: DetectedStackProfile;
};

type StackConfirmationAction = 'continue' | 'revise' | 'abort';

export async function resolveSelections(
  detection: DetectionReport,
  snapshotOrOverrides?: SnapshotContext | Partial<OnboardingSelections>,
  maybeOverrides?: Partial<OnboardingSelections>,
): Promise<OnboardingSelections> {
  const snapshot = isSnapshotContext(snapshotOrOverrides) ? snapshotOrOverrides : undefined;
  const overrides = isSnapshotContext(snapshotOrOverrides) ? maybeOverrides : snapshotOrOverrides;

  if (isInteractive() && !hasFullOverrides(overrides)) {
    return runInteractivePrompts(detection, snapshot, overrides);
  }

  return buildFromOverridesAndDetection(detection, snapshot, overrides);
}

function isSnapshotContext(
  value: SnapshotContext | Partial<OnboardingSelections> | undefined,
): value is SnapshotContext {
  return Boolean(value && 'toolchains' in value && 'packages' in value && 'profile' in value);
}

function hasFullOverrides(overrides?: Partial<OnboardingSelections>): boolean {
  return Boolean(
    overrides &&
    overrides.providers !== undefined &&
    (overrides.stack_profile !== undefined ||
      (overrides.stack !== undefined && overrides.capabilities !== undefined)),
  );
}

function buildFromOverridesAndDetection(
  detection: DetectionReport,
  snapshot?: {
    toolchains: ToolchainInfo[];
    packages: InstalledPackage[];
    profile: DetectedStackProfile;
  },
  overrides?: Partial<OnboardingSelections>,
): OnboardingSelections {
  const domain = inferSelectionDomain(detection, overrides, snapshot);
  if (
    overrides?.stack_profile === undefined &&
    overrides?.stack === undefined &&
    domain === 'coding' &&
    snapshot?.profile.frameworks.length === 0 &&
    snapshot?.profile.traits.some((trait) => ['docker', 'compose'].includes(trait))
  ) {
    throw new Error(
      'Detected container environment signals without a framework. Re-run onboarding interactively to choose a stack, or pass --stack <stack> together with --capability docker and/or --capability compose.',
    );
  }

  const stackProfile =
    overrides?.stack_profile ??
    (overrides?.stack !== undefined
      ? buildFallbackStackProfile(domain, overrides.stack, overrides.capabilities ?? [], snapshot)
      : shouldUseDetectedFallbackProfile(domain, snapshot?.profile)
        ? buildFallbackStackProfile(
            domain,
            resolveDetectedFallbackStack(domain, detection),
            detection.detected_capabilities,
            snapshot,
          )
        : snapshot!.profile);
  const stack =
    overrides?.stack ??
    getPrimaryStack({
      active_capabilities: domain === 'coding' ? ['content', 'coding', 'security'] : ['content'],
      stack_profile: stackProfile,
    });

  return {
    providers: overrides?.providers ?? ['claude-code'],
    domain,
    stack_profile: stackProfile,
    stack,
    capabilities: overrides?.capabilities ?? detection.detected_capabilities,
  };
}

function shouldUseDetectedFallbackProfile(
  domain: Domain,
  snapshotProfile?: DetectedStackProfile,
): boolean {
  if (!snapshotProfile) {
    return true;
  }

  if (domain === 'content') {
    return false;
  }

  return snapshotProfile.frameworks.length === 0;
}

function resolveDetectedFallbackStack(domain: Domain, detection: DetectionReport): Stack {
  if (detection.detected_stack !== null) {
    return detection.detected_stack;
  }

  if (domain === 'content') {
    return 'short-video';
  }

  throw new Error(
    'Detected coding signals without a resolved stack. Re-run onboarding interactively to choose a stack, or pass --stack <stack> together with any needed --capability values.',
  );
}

async function runInteractivePrompts(
  detection: DetectionReport,
  snapshot?: {
    toolchains: ToolchainInfo[];
    packages: InstalledPackage[];
    profile: DetectedStackProfile;
  },
  overrides?: Partial<OnboardingSelections>,
): Promise<OnboardingSelections> {
  let defaults = overrides;

  while (true) {
    const providers = await promptProviders(defaults?.providers);
    const selections = await promptInteractiveSelections({
      providers,
      domain: inferSelectionDomain(detection, defaults, snapshot),
      detection,
      snapshot,
      overrides: defaults,
    });
    const action = await promptStackConfirmation(detection, snapshot, selections);

    if (action === 'continue') {
      return selections;
    }

    if (action === 'abort') {
      throw new Error('Onboarding cancelled before confirmation.');
    }

    defaults = selections;
  }
}

async function promptInteractiveSelections(input: {
  providers: AdapterType[];
  domain: Domain;
  detection: DetectionReport;
  snapshot?: SnapshotContext;
  overrides?: Partial<OnboardingSelections>;
}): Promise<OnboardingSelections> {
  if (
    input.domain === 'content' &&
    input.overrides?.stack === undefined &&
    input.overrides?.stack_profile === undefined &&
    !input.detection.recommended_capabilities?.includes('coding')
  ) {
    return {
      providers: input.providers,
      domain: 'content',
      stack_profile: buildFallbackStackProfile('content', 'short-video', [], input.snapshot),
      stack: 'short-video',
      capabilities: [],
    };
  }

  if (
    input.domain === 'coding' &&
    input.snapshot?.profile &&
    input.detection.detected_stack !== null &&
    input.detection.confidence !== 'low' &&
    input.overrides?.stack === undefined &&
    input.overrides?.stack_profile === undefined
  ) {
    const stackProfile = shouldUseDetectedFallbackProfile(input.domain, input.snapshot.profile)
      ? buildFallbackStackProfile(
          input.domain,
          resolveDetectedFallbackStack(input.domain, input.detection),
          input.detection.detected_capabilities,
          input.snapshot,
        )
      : input.snapshot.profile;
    const stack = getPrimaryStack({
      active_capabilities:
        input.domain === 'coding' ? ['content', 'coding', 'security'] : ['content'],
      stack_profile: stackProfile,
    });

    return {
      providers: input.providers,
      domain: input.domain,
      stack_profile: stackProfile,
      stack,
      capabilities: [...stackProfile.traits],
    };
  }

  const stack = await promptStack(
    input.domain,
    input.overrides?.stack ?? input.detection.detected_stack ?? undefined,
  );
  const capabilities = await promptCapabilitiesForStack(stack);

  return {
    providers: input.providers,
    domain: input.domain,
    stack_profile: buildFallbackStackProfile(input.domain, stack, capabilities, input.snapshot),
    stack,
    capabilities,
  };
}

async function promptProviders(defaultProviders?: AdapterType[]): Promise<AdapterType[]> {
  const selected = await checkbox<AdapterType>({
    message: 'Which AI provider(s) do you want to use?',
    choices: [
      {
        name: 'Codex (OpenAI)',
        value: 'codex-cli',
        checked: defaultProviders?.includes('codex-cli') ?? true,
      },
      {
        name: 'Antigravity (Google)',
        value: 'antigravity',
        checked: defaultProviders?.includes('antigravity') ?? false,
      },
      {
        name: 'Claude Code (Anthropic)',
        value: 'claude-code',
        checked: defaultProviders?.includes('claude-code') ?? true,
      },
      {
        name: 'Gemini (Google)',
        value: 'gemini-cli',
        checked: defaultProviders?.includes('gemini-cli') ?? true,
      },
      {
        name: 'Junie (JetBrains)',
        value: 'junie',
        checked: defaultProviders?.includes('junie') ?? true,
      },
      {
        name: 'Cursor (Anysphere)',
        value: 'cursor',
        checked: defaultProviders?.includes('cursor') ?? false,
      },
      {
        name: 'GitHub Copilot (GitHub / VS Code Agent)',
        value: 'github-copilot',
        checked: defaultProviders?.includes('github-copilot') ?? false,
      },
      {
        name: 'Windsurf (Codeium)',
        value: 'windsurf',
        checked: defaultProviders?.includes('windsurf') ?? false,
      },
      {
        name: 'Continue (Continue.dev)',
        value: 'continue',
        checked: defaultProviders?.includes('continue') ?? false,
      },
      {
        name: 'Aider (paul-gauthier)',
        value: 'aider',
        checked: defaultProviders?.includes('aider') ?? false,
      },
      {
        name: 'AI Assistant (JetBrains)',
        value: 'aiassistant',
        checked: defaultProviders?.includes('aiassistant') ?? false,
      },
    ],
    validate(choices) {
      if (choices.length === 0) return 'Select at least one provider.';
      return true;
    },
  });

  return selected;
}

async function promptStack(domain: Domain, detectedStack?: Stack): Promise<Stack> {
  return select<Stack>({
    message: 'Which stack is this project using?',
    choices: getStackPromptChoices(domain),
    default: domain === 'content' ? 'short-video' : (detectedStack ?? 'laravel'),
  });
}

async function promptCapabilitiesForStack(stack: Stack): Promise<Capability[]> {
  if (stack === 'laravel') {
    return promptLaravelDetails();
  }
  if (stack === 'react') {
    return promptReactDetails();
  }
  if (stack === 'vue') {
    return promptVueDetails();
  }
  if (stack === 'short-video') {
    return [];
  }

  return promptContainerDetails(stack);
}

function formatStackName(stack: Stack): string {
  if (stack === 'short-video') {
    return 'Short Video';
  }

  return stack
    .split('-')
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function getStackPromptChoices(domain: Domain): Array<{ name: string; value: Stack }> {
  if (domain === 'content') {
    return [{ name: 'Short Video', value: 'short-video' }];
  }

  return DOMAIN_STACK_MAP.coding.map((stack) => ({
    name: formatStackName(stack),
    value: stack,
  }));
}

async function promptLaravelDetails(): Promise<Capability[]> {
  const capabilities: Capability[] = [];

  const inertia = await select<boolean>({
    message: 'Are you using Inertia.js?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (inertia) capabilities.push('inertia');

  const frontend = await select<Frontend>({
    message: 'Which frontend framework are you using?',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'React.js', value: 'react' },
      { name: 'Vue.js', value: 'vue' },
    ],
    default: 'none',
  });

  if (frontend === 'react') capabilities.push('react');
  if (frontend === 'vue') capabilities.push('vue');

  const tailwind = await select<boolean>({
    message: 'Are you using Tailwind CSS?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (tailwind) capabilities.push('tailwind');

  const boost = await select<boolean>({
    message: 'Are you using Laravel Boost?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (boost) capabilities.push('boost');

  const testing = await select<'pest' | 'phpunit' | 'none'>({
    message: 'Which testing framework are you using?',
    choices: [
      { name: 'PHPUnit (default)', value: 'phpunit' },
      { name: 'Pest', value: 'pest' },
      { name: 'Neither (configure later)', value: 'none' },
    ],
    default: 'phpunit',
  });

  if (testing === 'pest') capabilities.push('pest');
  if (testing === 'phpunit') capabilities.push('phpunit');

  const sail = await select<boolean>({
    message: 'Are you using Laravel Sail?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (sail) {
    capabilities.push('sail');
  } else {
    capabilities.push(...(await promptContainerDetails('laravel')));
  }

  return capabilities;
}

async function promptReactDetails(): Promise<Capability[]> {
  const capabilities: Capability[] = [];

  const appType = await select<ReactStackCapability>({
    message: 'Which React application type are you using?',
    choices: [
      { name: 'Next.js', value: 'next' },
      { name: 'Remix', value: 'remix' },
      { name: 'Vite SPA', value: 'vite-spa' },
      { name: 'Gatsby', value: 'gatsby' },
    ],
    default: 'next',
  });

  capabilities.push(appType);

  const tailwind = await select<boolean>({
    message: 'Are you using Tailwind CSS?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (tailwind) capabilities.push('tailwind');

  capabilities.push(...(await promptContainerDetails('react')));

  return capabilities;
}

async function promptVueDetails(): Promise<Capability[]> {
  const capabilities: Capability[] = [];

  const appType = await select<VueStackCapability>({
    message: 'Which Vue application type are you using?',
    choices: [
      { name: 'Nuxt', value: 'nuxt' },
      { name: 'Vite SPA', value: 'vite-spa' },
      { name: 'Quasar', value: 'quasar' },
    ],
    default: 'nuxt',
  });

  capabilities.push(appType);

  const tailwind = await select<boolean>({
    message: 'Are you using Tailwind CSS?',
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (tailwind) capabilities.push('tailwind');

  capabilities.push(...(await promptContainerDetails('vue')));

  return capabilities;
}

async function promptContainerDetails(stack: Stack): Promise<Capability[]> {
  const supported = new Set(STACK_CAPABILITIES_MAP[stack]);

  if (!supported.has('docker') && !supported.has('compose')) {
    return [];
  }

  const capabilities: Capability[] = [];
  const docker = await select<boolean>({
    message: `Does this ${formatStackName(stack)} project use Docker?`,
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (!docker) {
    return capabilities;
  }

  if (supported.has('docker')) {
    capabilities.push('docker');
  }

  if (!supported.has('compose')) {
    return capabilities;
  }

  const compose = await select<boolean>({
    message: `Does this ${formatStackName(stack)} project use Docker Compose?`,
    choices: [
      { name: 'No', value: false },
      { name: 'Yes', value: true },
    ],
    default: false,
  });

  if (compose) {
    capabilities.push('compose');
  }

  return capabilities;
}

function buildFallbackStackProfile(
  _domain: Domain,
  stack: Stack,
  capabilities: string[],
  snapshot?: {
    toolchains: ToolchainInfo[];
    packages: InstalledPackage[];
    profile?: DetectedStackProfile;
  },
): DetectedStackProfile {
  const fallbackSource = {
    file: 'interactive-onboarding',
    kind: 'fallback',
    detail: 'User-selected fallback stack profile',
  } satisfies DetectedStackProfile['sources'][number];

  return buildDetectedStackProfile({
    toolchains: snapshot?.toolchains ?? [],
    packages: snapshot?.packages ?? [],
    sources: deduplicateSources([...(snapshot?.profile?.sources ?? []), fallbackSource]),
    detectedTraits: snapshot?.profile?.traits ?? [],
    fallbackStack: stack,
    fallbackCapabilities: capabilities,
  });
}

function deduplicateSources(
  sources: DetectedStackProfile['sources'],
): DetectedStackProfile['sources'] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.file}::${source.kind}::${source.detail}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function promptStackConfirmation(
  detection: DetectionReport,
  snapshot: SnapshotContext | undefined,
  selections: OnboardingSelections,
): Promise<StackConfirmationAction> {
  if (!shouldConfirmSelections(selections)) {
    return 'continue';
  }

  process.stdout.write(`\n${renderStackConfirmationSummary(detection, snapshot, selections)}\n\n`);

  return select<StackConfirmationAction>({
    message: 'Continue with this detected stack profile?',
    choices: [
      { name: 'Continue', value: 'continue' },
      { name: 'Revise selections', value: 'revise' },
      { name: 'Abort onboarding', value: 'abort' },
    ],
    default: 'continue',
  });
}

function shouldConfirmSelections(selections: OnboardingSelections): boolean {
  return !(selections.domain === 'content' && selections.stack === 'short-video');
}

export function renderStackConfirmationSummary(
  detection: DetectionReport,
  snapshot: SnapshotContext | undefined,
  selections: OnboardingSelections,
): string {
  const effectiveStack =
    selections.stack ??
    getPrimaryStack({
      active_capabilities:
        selections.domain === 'coding' ? ['content', 'coding', 'security'] : ['content'],
      stack_profile: selections.stack_profile,
    });
  const lines = [
    'Detected stack summary',
    `- Domain: ${selections.domain}`,
    `- Primary stack: ${effectiveStack}`,
    `- Effective profile: ${summarizeStack(selections.stack_profile)}`,
    `- Confidence: ${detection.confidence}`,
    `- Frameworks: ${formatList(selections.stack_profile.frameworks)}`,
    `- Traits/capabilities: ${formatList(selections.stack_profile.traits)}`,
    `- Toolchains: ${formatToolchains(snapshot?.toolchains ?? [])}`,
    `- Version bands: ${formatVersionBands(selections.stack_profile.version_bands)}`,
    `- Packages sampled: ${formatPackages(snapshot?.packages ?? [])}`,
    `- Source signals: ${formatSources(selections.stack_profile.sources)}`,
  ];
  const detectedSummary =
    detection.detected_stack === null
      ? 'none'
      : `${detection.detected_domain ?? 'unknown'} / ${detection.detected_stack}`;
  const finalSummary = `${selections.domain} / ${effectiveStack}`;

  if (detectedSummary !== finalSummary) {
    lines.push(`- Detected choice: ${detectedSummary}`);
    lines.push(`- Final effective choice: ${finalSummary}`);
  }

  return lines.join('\n');
}

function formatList(values: string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function formatToolchains(toolchains: ToolchainInfo[]): string {
  return toolchains.length === 0
    ? 'none'
    : toolchains
        .map(
          (toolchain) =>
            `${toolchain.ecosystem}:${toolchain.package_manager} (${toolchain.lockfile})`,
        )
        .join(', ');
}

function formatVersionBands(bands: DetectedStackProfile['version_bands']): string {
  return bands.length === 0
    ? 'none'
    : bands
        .slice(0, 5)
        .map((band) => `${band.package_name}@${band.locked_version} -> ${band.range}`)
        .join(', ');
}

function formatPackages(packages: InstalledPackage[]): string {
  return packages.length === 0
    ? 'none'
    : packages
        .slice(0, 5)
        .map((pkg) => `${pkg.name}@${pkg.locked_version}`)
        .join(', ');
}

function formatSources(sources: DetectedStackProfile['sources']): string {
  return sources.length === 0
    ? 'none'
    : sources
        .slice(0, 5)
        .map((source) => `${source.file} (${source.kind})`)
        .join(', ');
}

function inferSelectionDomain(
  detection: DetectionReport,
  overrides?: Partial<OnboardingSelections>,
  snapshot?: Pick<SnapshotContext, 'profile'>,
): Domain {
  if (overrides?.domain) {
    return overrides.domain;
  }

  if (overrides?.stack === 'short-video') {
    return 'content';
  }

  if (overrides?.stack) {
    return 'coding';
  }

  if (detection.recommended_capabilities?.includes('coding')) {
    return 'coding';
  }

  if (
    (snapshot?.profile.frameworks.length ?? 0) > 0 ||
    (snapshot?.profile.traits.length ?? 0) > 0
  ) {
    return 'coding';
  }

  if (detection.detected_domain) {
    return detection.detected_domain;
  }

  return 'content';
}

import { getProfileDomain } from './project-profile.js';
import type { Capability, Stack } from './types/domain.js';
import type {
  DetectedStackProfile,
  InstalledPackage,
  StackDriftChange,
  StackDriftReport,
  StackSourceReference,
  ToolchainInfo,
} from './types/introspection.js';
import type { ProjectProfile } from './types/project-profile.js';

const FRAMEWORK_PACKAGE_MAP: Record<string, Stack> = {
  'laravel/framework': 'laravel',
  flutter: 'flutter',
  react: 'react',
  vue: 'vue',
  nuxt: 'vue',
  next: 'nextjs',
  flask: 'flask',
  '@nestjs/core': 'nestjs',
  '@nestjs/common': 'nestjs',
};

const TRAIT_PACKAGE_MAP: Record<string, string> = {
  'inertiajs/inertia-laravel': 'inertia',
  'laravel/boost': 'boost',
  'laravel/sail': 'sail',
  'phpunit/phpunit': 'phpunit',
  tailwindcss: 'tailwind',
  next: 'next',
  remix: 'remix',
  '@remix-run/react': 'remix',
  gatsby: 'gatsby',
  nuxt: 'nuxt',
  quasar: 'quasar',
  '@quasar/app-vite': 'quasar',
  vite: 'vite-spa',
  '@vitejs/plugin-react': 'vite-spa',
  '@vitejs/plugin-vue': 'vite-spa',
  '@prisma/client': 'prisma',
  prisma: 'prisma',
  '@trpc/server': 'trpc',
  '@trpc/client': 'trpc',
  'next-auth': 'next-auth',
  '@auth/core': 'next-auth',
  sqlalchemy: 'sqlalchemy',
  celery: 'celery',
  gunicorn: 'gunicorn',
  flask_login: 'flask-login',
  'flask-restx': 'flask-restx',
  'flask-restful': 'flask-restx',
  typeorm: 'typeorm',
  '@nestjs/swagger': 'swagger',
  '@nestjs/graphql': 'graphql',
  '@nestjs/microservices': 'microservices',
  '@nestjs/passport': 'passport',
  '@nestjs/platform-fastify': 'fastify',
  'androidx.room:room-runtime': 'room',
  'androidx.hilt:hilt-navigation-compose': 'hilt',
  'androidx.navigation:navigation-compose': 'navigation',
  'org.jetbrains.kotlinx:kotlinx-coroutines-core': 'coroutines',
  'com.squareup.retrofit2:retrofit': 'retrofit',
  'androidx.datastore:datastore': 'datastore',
  'androidx.compose.ui:ui': 'jetpack-compose',
  vitest: 'vitest',
  '@playwright/test': 'playwright',
  'pestphp/pest': 'pest',
  jest: 'jest',
  pinia: 'pinia',
  vuex: 'vuex',
};

const VERSIONED_PACKAGES = new Set([
  'laravel/framework',
  'react',
  'vue',
  'next',
  'flask',
  '@nestjs/core',
  'nuxt',
  'tailwindcss',
  'laravel/boost',
  'flutter',
]);

export function buildDetectedStackProfile(input: {
  toolchains: ToolchainInfo[];
  packages: InstalledPackage[];
  sources: StackSourceReference[];
  detectedTraits?: string[];
  fallbackStack?: Stack | null;
  fallbackCapabilities?: string[];
}): DetectedStackProfile {
  const frameworks = new Set<string>();
  const traits = new Set<string>([
    ...(input.fallbackCapabilities ?? []),
    ...(input.detectedTraits ?? []),
  ]);

  for (const pkg of input.packages) {
    const framework = FRAMEWORK_PACKAGE_MAP[pkg.name];
    if (framework) {
      frameworks.add(framework);
    }

    const trait = TRAIT_PACKAGE_MAP[pkg.name];
    if (trait) {
      traits.add(trait);
    }
  }

  if (frameworks.size === 0 && input.fallbackStack) {
    frameworks.add(input.fallbackStack);
  }

  if (input.fallbackStack === 'laravel') {
    frameworks.add('laravel');
  }

  if (frameworks.has('nextjs')) {
    frameworks.delete('react');
  }

  if (frameworks.has('nestjs')) {
    frameworks.delete('express');
  }

  const versionBands = Array.from(
    input.packages
      .filter((pkg) => VERSIONED_PACKAGES.has(pkg.name))
      .sort(compareVersionBandPackages)
      .reduce(
        (bands, pkg) =>
          bands.has(pkg.name)
            ? bands
            : bands.set(pkg.name, {
                name: `${pkg.name}:${majorBand(pkg.locked_version || pkg.version_constraint)}`,
                package_name: pkg.name,
                range: majorBand(pkg.locked_version || pkg.version_constraint),
                locked_version: pkg.locked_version,
                source:
                  pkg.locked_version !== '' && pkg.locked_version !== pkg.version_constraint
                    ? ('lockfile' as const)
                    : ('manifest' as const),
              }),
        new Map<string, DetectedStackProfile['version_bands'][number]>(),
      )
      .values(),
  ).sort((left, right) => left.package_name.localeCompare(right.package_name));

  return {
    frameworks: Array.from(frameworks).sort(compareFrameworks),
    traits: Array.from(traits).sort(),
    toolchains: input.toolchains,
    version_bands: versionBands,
    sources: input.sources,
  };
}

export function getPrimaryStack(
  profile:
    | Partial<Pick<ProjectProfile, 'active_capabilities' | 'routing' | 'stack_profile'>>
    | undefined,
): Stack {
  const frameworks = Array.isArray(profile?.stack_profile?.frameworks)
    ? profile.stack_profile.frameworks
    : [];
  const legacyStack = profile?.routing ? (profile.routing as { stack?: Stack }).stack : undefined;

  if (frameworks.length > 0) return frameworks[0] as Stack;
  if (legacyStack) return legacyStack;
  if (
    profile &&
    getProfileDomain(
      profile as Pick<ProjectProfile, 'active_capabilities' | 'routing' | 'stack_profile'>,
    ) === 'content'
  ) {
    return 'short-video';
  }

  return 'laravel';
}

export function getLegacyCapabilities(
  profile: Partial<Pick<ProjectProfile, 'routing' | 'stack_profile'>> | undefined,
): Capability[] {
  const legacy = profile?.routing
    ? (profile.routing as { capabilities?: Capability[] }).capabilities
    : undefined;
  if (Array.isArray(legacy)) {
    return legacy;
  }

  return (profile?.stack_profile?.traits ?? []).filter(isCapability) as Capability[];
}

export function compareStackProfiles(
  previous: DetectedStackProfile | null,
  current: DetectedStackProfile,
): StackDriftReport {
  if (previous === null) {
    return {
      generated_at: new Date().toISOString(),
      status: 'no-drift',
      previous_profile: null,
      current_profile: current,
      material_changes: [],
      newly_active_rule_bands: [],
      newly_inactive_rule_bands: [],
      review_targets: [],
    };
  }

  const changes: StackDriftChange[] = [];

  const previousFrameworks = new Set(previous?.frameworks ?? []);
  const currentFrameworks = new Set(current.frameworks);
  const previousTraits = new Set(previous?.traits ?? []);
  const currentTraits = new Set(current.traits);
  const previousBands = new Map(
    (previous?.version_bands ?? []).map((band) => [band.package_name, band]),
  );
  const currentBands = new Map(current.version_bands.map((band) => [band.package_name, band]));
  const previousToolchains = JSON.stringify(previous?.toolchains ?? []);
  const currentToolchains = JSON.stringify(current.toolchains);

  for (const framework of currentFrameworks) {
    if (!previousFrameworks.has(framework)) {
      changes.push({ type: 'framework-added', key: framework, after: framework });
    }
  }
  for (const framework of previousFrameworks) {
    if (!currentFrameworks.has(framework)) {
      changes.push({ type: 'framework-removed', key: framework, before: framework });
    }
  }

  for (const trait of currentTraits) {
    if (!previousTraits.has(trait)) {
      changes.push({ type: 'trait-added', key: trait, after: trait });
    }
  }
  for (const trait of previousTraits) {
    if (!currentTraits.has(trait)) {
      changes.push({ type: 'trait-removed', key: trait, before: trait });
    }
  }

  for (const [name, band] of currentBands) {
    const previousBand = previousBands.get(name);
    if (previousBand && previousBand.range !== band.range) {
      changes.push({
        type: 'version-band-changed',
        key: name,
        before: previousBand.range,
        after: band.range,
      });
    }
  }

  if (previous !== null && previousToolchains !== currentToolchains) {
    changes.push({
      type: 'toolchain-changed',
      key: 'toolchains',
      before: previousToolchains,
      after: currentToolchains,
    });
  }

  const reviewTargets = deriveReviewTargets(changes);

  return {
    generated_at: new Date().toISOString(),
    status: changes.length === 0 ? 'no-drift' : 'drift-detected',
    previous_profile: previous,
    current_profile: current,
    material_changes: changes,
    newly_active_rule_bands: current.version_bands
      .filter((band) => !previousBands.has(band.package_name))
      .map((band) => band.name),
    newly_inactive_rule_bands: Array.from(previousBands.values())
      .filter((band) => !currentBands.has(band.package_name))
      .map((band) => band.name),
    review_targets: reviewTargets,
  };
}

export function summarizeStack(profile: DetectedStackProfile): string {
  const frameworks = profile.frameworks.join(', ') || 'none';
  const traits = profile.traits.join(', ') || 'none';
  return `frameworks: ${frameworks}; traits: ${traits}`;
}

function deriveReviewTargets(changes: StackDriftChange[]): string[] {
  const targets = new Set<string>();

  for (const change of changes) {
    if (change.type === 'framework-added' || change.type === 'framework-removed') {
      targets.add('docs/instructions/architecture/**');
      targets.add('docs/modules/*/ui/**');
      targets.add('docs/modules/*/api/**');
      targets.add('docs/instructions/stack/**');
    }

    if (change.type === 'trait-added' || change.type === 'trait-removed') {
      targets.add('docs/instructions/stack/**');
      targets.add('docs/modules/*/ui/**');
      targets.add('docs/instructions/tools/**');
    }

    if (change.type === 'version-band-changed') {
      targets.add('docs/instructions/stack/version-rules.md');
      targets.add('docs/instructions/architecture/**');
    }
  }

  return Array.from(targets).sort();
}

function compareFrameworks(left: string, right: string): number {
  return frameworkRank(left) - frameworkRank(right) || left.localeCompare(right);
}

function compareVersionBandPackages(left: InstalledPackage, right: InstalledPackage): number {
  return rootDepth(left.root) - rootDepth(right.root) || left.name.localeCompare(right.name);
}

function rootDepth(root: string | undefined): number {
  if (!root || root === '.') {
    return 0;
  }

  return root.split('/').filter(Boolean).length;
}

function frameworkRank(name: string): number {
  switch (name) {
    case 'laravel':
      return 0;
    case 'flutter':
      return 1;
    case 'nextjs':
      return 2;
    case 'react':
      return 3;
    case 'vue':
      return 4;
    case 'nestjs':
      return 5;
    case 'dotnet':
      return 6;
    case 'flask':
      return 7;
    case 'kotlin-android':
      return 8;
    case 'short-video':
      return 9;
    default:
      return 10;
  }
}

function isCapability(value: string): value is Capability {
  return [
    'inertia',
    'vue',
    'react',
    'tailwind',
    'boost',
    'pest',
    'phpunit',
    'docker',
    'compose',
    'sail',
    'next',
    'remix',
    'vite-spa',
    'gatsby',
    'nuxt',
    'quasar',
    'blazor',
    'ef-core',
    'minimal-api',
    'mvc',
    'razor-pages',
    'signalr',
    'azure',
    'identity',
    'app-router',
    'pages-router',
    'prisma',
    'trpc',
    'next-auth',
    'sqlalchemy',
    'celery',
    'blueprints',
    'flask-login',
    'flask-restx',
    'gunicorn',
    'typeorm',
    'graphql',
    'microservices',
    'swagger',
    'passport',
    'fastify',
    'jetpack-compose',
    'room',
    'hilt',
    'retrofit',
    'coroutines',
    'navigation',
    'datastore',
  ].includes(value);
}

function majorBand(value: string): string {
  const match = value.match(/(\d+)/);
  return match?.[1] ? `^${match[1]}` : value;
}

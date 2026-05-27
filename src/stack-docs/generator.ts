import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { compareStackProfiles, summarizeStack } from '@/core/stack-profile.js';
import type { StackDriftReport, StackSnapshot } from '@/core/types/introspection.js';
import { sanitizeStackSnapshotRepository } from '@/onboarding/manifest-writer.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';

export interface WriteStackArtifactsOptions {
  writeHumanDocs?: boolean;
}

export async function writeStackArtifacts(
  projectRoot: string,
  snapshot: StackSnapshot,
  previousSnapshot?: StackSnapshot | null,
  options: WriteStackArtifactsOptions = {},
): Promise<StackDriftReport> {
  const existingDrift = await readExistingDrift(projectRoot);
  const computedDrift = compareStackProfiles(previousSnapshot?.profile ?? null, snapshot.profile);
  const drift =
    computedDrift.status === 'no-drift' && existingDrift !== null ? existingDrift : computedDrift;
  const sanitizedSnapshot = sanitizeStackSnapshotRepository(projectRoot, snapshot);
  await writeFile(
    join(projectRoot, PATHS.STACK_SNAPSHOT),
    `${JSON.stringify(sanitizedSnapshot, null, 2)}\n`,
  );
  await writeFile(join(projectRoot, PATHS.STACK_DRIFT), `${JSON.stringify(drift, null, 2)}\n`);

  if (!options.writeHumanDocs) {
    return drift;
  }

  await mkdir(join(projectRoot, PATHS.FRAMEWORK_STACK_DIR), { recursive: true });
  const stackDir = join(projectRoot, PATHS.FRAMEWORK_STACK_DIR);
  await writeFile(join(stackDir, 'overview.md'), await buildOverview(projectRoot, snapshot, drift));
  await writeFile(join(stackDir, 'frameworks.md'), await buildFrameworks(projectRoot, snapshot));
  await writeFile(join(stackDir, 'dependencies.md'), buildDependencies(snapshot));
  await writeFile(join(stackDir, 'tooling.md'), buildTooling(snapshot));
  await writeFile(join(stackDir, 'version-rules.md'), buildVersionRules(snapshot, drift));
  await writeFile(join(stackDir, 'sources.md'), buildSources(snapshot));
  await writeFile(join(stackDir, 'drift-report.md'), buildDriftReport(drift));

  return drift;
}

async function readExistingDrift(projectRoot: string): Promise<StackDriftReport | null> {
  try {
    return JSON.parse(
      await readFile(join(projectRoot, PATHS.STACK_DRIFT), 'utf8'),
    ) as StackDriftReport;
  } catch {
    return null;
  }
}

async function buildOverview(
  projectRoot: string,
  snapshot: StackSnapshot,
  drift: StackDriftReport,
): Promise<string> {
  const manifests = new Map(
    getPacksForFrameworks(snapshot.profile.frameworks, projectRoot).map((pack) => [
      pack.manifest.name,
      pack.manifest,
    ]),
  );
  const frameworkSummary = snapshot.profile.frameworks
    .map((framework) => manifests.get(framework)?.display_name ?? framework)
    .join(', ');

  return `# Stack Overview

- Generated at: \`${snapshot.generated_at}\`
- Profile: ${summarizeStack(snapshot.profile)}
- Drift status: \`${drift.status}\`
- Frameworks: ${
    frameworkSummary
      ? frameworkSummary
          .split(', ')
          .map((value) => `\`${value}\``)
          .join(', ')
      : 'none'
  }
- Traits: ${snapshot.profile.traits.map((value) => `\`${value}\``).join(', ') || 'none'}
`;
}

async function buildFrameworks(projectRoot: string, snapshot: StackSnapshot): Promise<string> {
  const packs = new Map(
    getPacksForFrameworks(snapshot.profile.frameworks, projectRoot).map((pack) => [
      pack.manifest.name,
      pack,
    ]),
  );
  const lines = ['# Frameworks', ''];
  for (const framework of snapshot.profile.frameworks) {
    const pack = packs.get(framework);
    const manifest = pack?.manifest;
    const bands = snapshot.profile.version_bands.filter((band) =>
      band.name.startsWith(`${mapFrameworkPackage(framework)}:`),
    );
    lines.push(`## ${manifest?.display_name ?? framework}`);
    if (manifest?.description) {
      lines.push('', manifest.description, '');
    }
    if (bands.length === 0) {
      lines.push('- No version band detected.');
    } else {
      for (const band of bands) {
        lines.push(
          `- \`${band.package_name}\`: \`${band.locked_version}\` -> active rule band \`${band.range}\``,
        );
      }
    }
    const conventions = await readTemplate(pack?.root, manifest?.docs?.conventions_template);
    if (conventions) {
      lines.push('', '### Pack Conventions', '', conventions.trim(), '');
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function buildDependencies(snapshot: StackSnapshot): string {
  const lines = ['# Dependencies', ''];
  const runtime = snapshot.packages.filter((pkg) => !pkg.is_dev);
  const dev = snapshot.packages.filter((pkg) => pkg.is_dev);

  lines.push('## Runtime');
  lines.push(...(runtime.length === 0 ? ['- None'] : runtime.map(formatPackage)));
  lines.push('', '## Dev');
  lines.push(...(dev.length === 0 ? ['- None'] : dev.map(formatPackage)));

  return `${lines.join('\n')}\n`;
}

function buildTooling(snapshot: StackSnapshot): string {
  const environmentTraits = snapshot.profile.traits.filter((trait) =>
    ['docker', 'compose', 'sail'].includes(trait),
  );

  return `# Tooling

## Toolchains

${snapshot.profile.toolchains
  .map(
    (toolchain) =>
      `- \`${toolchain.package_manager}\` for \`${toolchain.ecosystem}\` with lockfile \`${toolchain.lockfile}\``,
  )
  .join('\n')}

## Environment Traits

${environmentTraits.map((trait) => `- \`${trait}\``).join('\n') || '- None'}
`;
}

function buildVersionRules(snapshot: StackSnapshot, drift: StackDriftReport): string {
  return `# Version Rules

## Active Rule Bands

${snapshot.profile.version_bands.map((band) => `- \`${band.name}\``).join('\n') || '- None'}

## Drift Notes

${drift.material_changes.map((change) => `- \`${change.type}\` on \`${change.key}\`${change.after ? ` -> \`${change.after}\`` : ''}${change.before ? ` (from \`${change.before}\`)` : ''}`).join('\n') || '- No material stack drift detected.'}
`;
}

function buildSources(snapshot: StackSnapshot): string {
  return `# Sources

${snapshot.profile.sources.map((source) => `- \`${source.file}\` via \`${source.kind}\`: ${source.detail}`).join('\n') || '- No sources recorded.'}
`;
}

function buildDriftReport(drift: StackDriftReport): string {
  return `# Stack Drift Report

- Status: \`${drift.status}\`
- Previous: ${drift.previous_profile ? summarizeStack(drift.previous_profile) : 'none'}
- Current: ${summarizeStack(drift.current_profile)}

## Material Changes

${drift.material_changes.map((change) => `- \`${change.type}\`: \`${change.key}\`${change.before ? ` from \`${change.before}\`` : ''}${change.after ? ` to \`${change.after}\`` : ''}`).join('\n') || '- None'}

## Review Targets

${drift.review_targets.map((target) => `- \`${target}\``).join('\n') || '- None'}
`;
}

function formatPackage(pkg: StackSnapshot['packages'][number]): string {
  return `- \`${pkg.name}\` @ \`${pkg.locked_version}\`${pkg.is_dev ? ' (dev)' : ''}`;
}

function mapFrameworkPackage(framework: string): string {
  switch (framework) {
    case 'laravel':
      return 'laravel/framework';
    case 'react':
      return 'react';
    case 'nextjs':
      return 'next';
    case 'vue':
      return 'vue';
    case 'flutter':
      return 'flutter';
    case 'dotnet':
      return 'Microsoft.AspNetCore.App';
    case 'django':
      return 'django';
    case 'fastapi':
      return 'fastapi';
    case 'flask':
      return 'flask';
    case 'rails':
      return 'rails';
    case 'spring-boot':
      return 'org.springframework.boot:spring-boot-starter-web';
    case 'express':
      return 'express';
    case 'nestjs':
      return '@nestjs/core';
    case 'angular':
      return '@angular/core';
    case 'svelte':
      return 'svelte';
    case 'astro':
      return 'astro';
    case 'go-web':
      return 'github.com/gin-gonic/gin';
    case 'rust-web':
      return 'axum';
    case 'kotlin-android':
      return 'com.android.application';
    default:
      return framework;
  }
}

async function readTemplate(
  packRoot: string | undefined,
  templatePath?: string,
): Promise<string | null> {
  if (!packRoot || !templatePath) {
    return null;
  }

  try {
    return await readFile(join(packRoot, templatePath), 'utf8');
  } catch {
    return null;
  }
}

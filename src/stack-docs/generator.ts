import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { detectAnalyticsProvider } from '@/analytics/detect.js';
import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
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
  await writeAnalyticsDoc(projectRoot, stackDir);

  return drift;
}

/**
 * Analytics v2 (issue #279): when the `analytics_instrumentation` flag is ON, write the
 * `analytics.md` stack doc — the human-readable home for the detected provider + convention
 * and the tracking-plan-as-code contract. When the flag is OFF, INV-1 (OFF is silent) holds:
 * we write nothing and remove any stale doc a previously-enabled onboard left behind.
 */
async function writeAnalyticsDoc(projectRoot: string, stackDir: string): Promise<void> {
  const docPath = join(stackDir, 'analytics.md');
  let flagEnabled: boolean;
  try {
    flagEnabled = resolveFrameworkConfig(projectRoot).features.analytics_instrumentation;
    /* v8 ignore next 3 -- defensive: a malformed config never breaks doc generation */
  } catch {
    flagEnabled = false;
  }
  if (!flagEnabled) {
    try {
      await rm(docPath, { force: true });
      /* v8 ignore next 3 -- defensive: rm(force) only throws on rare fs errors */
    } catch {
      // Best-effort stale cleanup; a failure here must never break onboarding.
    }
    return;
  }
  await writeFile(docPath, buildAnalytics(projectRoot));
}

/** Render the analytics tracking-plan stack doc from read-only provider detection. */
export function buildAnalytics(projectRoot: string): string {
  const detection = detectAnalyticsProvider(projectRoot);
  const detectionLines = detection
    ? [
        `- Provider: **${detection.providerDisplay}** (\`${detection.provider}\`)`,
        `- Confidence: \`${detection.confidence}\``,
        `- Observed naming convention: ${
          detection.convention ? `\`${detection.convention}\`` : '_none observed yet_'
        }`,
      ].join('\n')
    : '- No analytics provider detected yet. Add one and re-run onboarding to populate this.';
  return `# Analytics

Analytics instrumentation is **enabled** for this project (\`analytics_instrumentation\`).
paqad treats analytics as a **tracking plan as code**: every feature instruments its events,
each event is documented as a reviewed, versioned per-event doc, and every new event is
governed through a Decision Pause packet — so the team keeps a shared, attributed record of
what is tracked and why, reviewed in the normal PR.

## Detected provider

${detectionLines}

## How events are governed

Every tracked event carries a governance triple:

1. **Decision packet** (who / why) — every new event opens a Decision Pause packet capturing
   the proposed name + normalized slug, provider(s), feature, and rationale, resolved and
   committed with the PR.
2. **Per-event doc** (what it means) — \`docs/modules/{module}/analytics/{feature}/{event}.md\`,
   one doc per event with a section per provider. The filename is a normalized slug; the exact
   event string is recorded inside, so casing-variant duplicates collapse to one doc.
3. **AC + traceability** (proof) — one \`AC-TRACK\` per event, proven against the delivering
   code and its doc; an unproven event surfaces as \`TR-UNTESTED-PROMISE\`.

## Convention

Pick one naming convention and be 100% consistent (object-action and past tense are common
defaults, not rigid rules). No variable data in event names — dynamic values are properties.

## Honest limits

This is PR/review-time governance via doc + AC existence. It is **not** type-safe codegen, not
ingestion-time or real-time blocking, and not PII redaction at capture — those live at your CDP.
`;
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

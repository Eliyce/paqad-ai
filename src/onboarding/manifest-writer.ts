import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { writeProjectProfile as writeCanonicalProjectProfile } from '@/core/project-profile.js';
import type { DetectionReport } from '@/core/types/health.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type {
  RepositoryApplication,
  RepositoryContext,
  RepositoryProjectCandidate,
} from '@/core/types/repository.js';

export function writeProjectProfile(projectRoot: string, profile: ProjectProfile): string {
  return writeCanonicalProjectProfile(projectRoot, profile);
}

export function writeDetectionReport(projectRoot: string, report: DetectionReport): string {
  const path = join(projectRoot, PATHS.DETECTION_REPORT);
  mkdirSync(dirname(path), { recursive: true });
  const sanitized = sanitizeDetectionReport(projectRoot, report);
  writeJsonPreservingTimestamp(path, sanitized, 'timestamp');
  return path;
}

export function writeFrameworkMetadata(projectRoot: string, version: string): void {
  mkdirSync(dirname(join(projectRoot, PATHS.FRAMEWORK_VERSION)), {
    recursive: true,
  });
  writeFrameworkVersionPreservingTimestamp(
    join(projectRoot, PATHS.FRAMEWORK_VERSION),
    version,
    new Date().toISOString(),
  );
  writeFileSync(join(projectRoot, PATHS.FRAMEWORK_PATH), `${resolveFrameworkInstallReference()}\n`);
}

export function writeOnboardingManifest(projectRoot: string, manifest: OnboardingManifest): string {
  const path = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  const sanitized = sanitizeOnboardingManifest(projectRoot, manifest);
  writeJsonPreservingTimestamp(path, sanitized, 'generated_at');
  return path;
}

/**
 * Writes a JSON document but, if the destination already exists and the
 * payload is byte-equal except for the timestamp field, preserves the existing
 * timestamp. Makes re-runs idempotent when nothing meaningful changed.
 */
export function writeJsonPreservingTimestamp<T extends object>(
  path: string,
  value: T,
  timestampField: keyof T & string,
): void {
  const previousTimestamp = readPreviousJsonTimestamp(path, timestampField);
  if (previousTimestamp !== null) {
    const candidate = { ...value, [timestampField]: previousTimestamp };
    const candidateJson = JSON.stringify(candidate, null, 2);
    const existing = readFileSync(path, 'utf8');
    if (candidateJson === existing) {
      // No real change → keep the file (and its timestamp) byte-identical.
      return;
    }
  }
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function writeFrameworkVersionPreservingTimestamp(
  path: string,
  version: string,
  now: string,
): void {
  const previous = readPreviousFrameworkVersion(path);
  const timestamp = previous && previous.version === version ? previous.updatedAt : now;
  writeFileSync(path, `version=${version}\nupdated_at=${timestamp}\n`);
}

function readPreviousJsonTimestamp(path: string, timestampField: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const value = parsed[timestampField];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function readPreviousFrameworkVersion(path: string): { version: string; updatedAt: string } | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, 'utf8');
    const versionMatch = content.match(/^version=(.*)$/m);
    const updatedMatch = content.match(/^updated_at=(.*)$/m);
    if (!versionMatch || !updatedMatch) {
      return null;
    }
    return { version: versionMatch[1].trim(), updatedAt: updatedMatch[1].trim() };
  } catch {
    return null;
  }
}

export function resolveFrameworkInstallPath(): string {
  return process.env.PAQAD_FRAMEWORK_HOME ?? toPosixPath(join(homedir(), '.paqad-ai/current'));
}

function resolveFrameworkInstallReference(): string {
  return process.env.PAQAD_FRAMEWORK_HOME ? '$PAQAD_FRAMEWORK_HOME' : '~/.paqad-ai/current';
}

function sanitizeDetectionReport(projectRoot: string, report: DetectionReport): DetectionReport {
  return {
    ...report,
    repository: report.repository
      ? sanitizeRepositoryContext(projectRoot, report.repository)
      : undefined,
  };
}

function sanitizeOnboardingManifest(
  projectRoot: string,
  manifest: OnboardingManifest,
): OnboardingManifest {
  return {
    ...manifest,
    project_root:
      typeof manifest.project_root === 'string'
        ? sanitizePersistedPath(projectRoot, manifest.project_root)
        : manifest.project_root,
    detected: manifest.detected ? sanitizeDetectionReport(projectRoot, manifest.detected) : null,
    repository: manifest.repository
      ? sanitizeRepositoryContext(projectRoot, manifest.repository)
      : undefined,
  };
}

function sanitizeRepositoryContext(
  projectRoot: string,
  repository: RepositoryContext,
): RepositoryContext {
  return {
    ...repository,
    selected_root: sanitizePersistedPath(projectRoot, repository.selected_root),
    ignored_paths: repository.ignored_paths.map((path) => sanitizePersistedPath(projectRoot, path)),
    projects: repository.projects.map((project) => sanitizeRepositoryProject(projectRoot, project)),
    applications: repository.applications.map((application) =>
      sanitizeRepositoryApplication(projectRoot, application),
    ),
    primary_project_root:
      repository.primary_project_root === null
        ? null
        : sanitizePersistedPath(projectRoot, repository.primary_project_root),
  };
}

function sanitizeRepositoryProject(
  projectRoot: string,
  project: RepositoryProjectCandidate,
): RepositoryProjectCandidate {
  return {
    ...project,
    root: sanitizePersistedPath(projectRoot, project.root),
    parent_root:
      project.parent_root === null ? null : sanitizePersistedPath(projectRoot, project.parent_root),
  };
}

function sanitizeRepositoryApplication(
  projectRoot: string,
  application: RepositoryApplication,
): RepositoryApplication {
  return {
    ...application,
    root: sanitizePersistedPath(projectRoot, application.root),
    component_roots: application.component_roots.map((root) =>
      sanitizePersistedPath(projectRoot, root),
    ),
  };
}

function sanitizePersistedPath(projectRoot: string, value: string): string {
  if (value === '.') {
    return value;
  }

  // Normalize separators up front so windows/posix comparisons work uniformly.
  const normalizedValue = toPosixPath(value);
  const normalizedRoot = toPosixPath(projectRoot);

  if (normalizedValue === normalizedRoot) {
    return '.';
  }

  // Strip projectRoot prefix when the value lives under it.
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  if (normalizedValue.startsWith(prefix)) {
    return normalizedValue.slice(prefix.length);
  }

  // For values that are already relative (no drive letter / leading slash), return them
  // as-is rather than resolving against process.cwd() — node:path.relative is unsafe
  // for relative inputs because both sides get resolved against cwd first.
  const isAbsoluteWindows = /^[a-zA-Z]:\//.test(normalizedValue);
  const isAbsolutePosix = normalizedValue.startsWith('/');
  if (!isAbsoluteWindows && !isAbsolutePosix) {
    return normalizedValue;
  }

  // Absolute path outside projectRoot (sibling or above) — fall back to path.relative,
  // which only behaves predictably when BOTH inputs are absolute (the case here).
  const relativePath = relative(projectRoot, value);
  if (relativePath === '') {
    return '.';
  }
  if (relativePath !== '..' && !relativePath.startsWith(`..${sep}`)) {
    return toPosixPath(relativePath);
  }
  return normalizedValue;
}

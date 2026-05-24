import { mkdirSync, writeFileSync } from 'node:fs';
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
  writeFileSync(path, JSON.stringify(sanitizeDetectionReport(projectRoot, report), null, 2));
  return path;
}

export function writeFrameworkMetadata(projectRoot: string, version: string): void {
  mkdirSync(dirname(join(projectRoot, PATHS.FRAMEWORK_VERSION)), {
    recursive: true,
  });
  const content = `version=${version}\nupdated_at=${new Date().toISOString()}\n`;
  writeFileSync(join(projectRoot, PATHS.FRAMEWORK_VERSION), content);
  writeFileSync(join(projectRoot, PATHS.FRAMEWORK_PATH), `${resolveFrameworkInstallReference()}\n`);
}

export function writeOnboardingManifest(projectRoot: string, manifest: OnboardingManifest): string {
  const path = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sanitizeOnboardingManifest(projectRoot, manifest), null, 2));
  return path;
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

  const relativePath = relative(projectRoot, value);
  if (relativePath === '') {
    return '.';
  }

  if (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && relativePath !== '') {
    return relativePath.replaceAll('\\', '/');
  }

  return value;
}

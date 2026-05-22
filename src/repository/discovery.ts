import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { StackEcosystem } from '@/core/types/introspection.js';
import type {
  RepositoryApplication,
  RepositoryContext,
  RepositoryProjectCandidate,
} from '@/core/types/repository.js';

const DEFAULT_SCAN_MAX_DEPTH = 5;
const PROJECT_MARKERS = new Map<string, StackEcosystem>([
  ['package.json', 'node'],
  ['composer.json', 'php'],
  ['pubspec.yaml', 'dart'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['Pipfile', 'python'],
  ['setup.py', 'python'],
  ['Gemfile', 'ruby'],
  ['go.mod', 'go'],
  ['Cargo.toml', 'rust'],
  ['pom.xml', 'jvm'],
  ['build.gradle', 'jvm'],
  ['build.gradle.kts', 'jvm'],
  ['artisan', 'php'],
  ['manage.py', 'python'],
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.dart_tool',
  '.gradle',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);

const NON_CANONICAL_DIRECTORIES = new Set([
  '__fixtures__',
  'demo',
  'demos',
  'example',
  'examples',
  'fixtures',
  'test-fixtures',
  'tmp',
]);

const COMPONENT_DIRECTORY_NAMES = new Set(['client', 'frontend', 'ui', 'web']);

export async function discoverRepositoryContext(
  projectRoot: string,
  options?: { maxDepth?: number },
): Promise<RepositoryContext> {
  const maxDepth = options?.maxDepth ?? DEFAULT_SCAN_MAX_DEPTH;
  const ignoredPaths = new Set<string>();
  const candidates = new Map<string, RepositoryProjectCandidate>();

  await walk(projectRoot, '.', 0, maxDepth, candidates, ignoredPaths);

  const sortedCandidates = Array.from(candidates.values()).sort(compareCandidates);
  const projects = classifyProjects(sortedCandidates);
  const applications = buildApplications(projects);
  const primaryProjectRoot = resolvePrimaryProjectRoot(projects, applications);

  return {
    selected_root: projectRoot,
    scan_max_depth: maxDepth,
    ignored_paths: Array.from(ignoredPaths).sort(),
    projects,
    applications,
    primary_project_root: primaryProjectRoot,
  };
}

export function prefixRepositoryPath(root: string, relativePath: string): string {
  if (root === '.' || root === '') {
    return relativePath;
  }

  return join(root, relativePath);
}

async function walk(
  projectRoot: string,
  relativeDir: string,
  depth: number,
  maxDepth: number,
  candidates: Map<string, RepositoryProjectCandidate>,
  ignoredPaths: Set<string>,
): Promise<void> {
  const absoluteDir = relativeDir === '.' ? projectRoot : join(projectRoot, relativeDir);
  let entries;

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  const entryNames = new Set(entries.map((entry) => entry.name));
  const markers = Array.from(PROJECT_MARKERS.keys()).filter((marker) => entryNames.has(marker));

  if (markers.length > 0) {
    const ecosystems = Array.from(
      new Set(markers.map((marker) => PROJECT_MARKERS.get(marker)).filter(isDefined)),
    ).sort();
    candidates.set(relativeDir, {
      root: relativeDir,
      role: 'standalone',
      parent_root: null,
      markers: markers.sort(),
      ecosystems,
    });
  }

  if (depth >= maxDepth) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childRelativePath = relativeDir === '.' ? entry.name : join(relativeDir, entry.name);
    if (IGNORED_DIRECTORIES.has(entry.name) || NON_CANONICAL_DIRECTORIES.has(entry.name)) {
      ignoredPaths.add(childRelativePath);
      continue;
    }

    await walk(projectRoot, childRelativePath, depth + 1, maxDepth, candidates, ignoredPaths);
  }
}

function classifyProjects(candidates: RepositoryProjectCandidate[]): RepositoryProjectCandidate[] {
  const byRoot = new Map(candidates.map((candidate) => [candidate.root, candidate]));
  const result: RepositoryProjectCandidate[] = [];

  for (const candidate of candidates) {
    const ancestors = findAncestorCandidates(candidate.root, byRoot);
    const parent = ancestors[0] ?? null;
    const role = parent && isLinkedComponent(parent, candidate) ? 'component' : 'standalone';

    result.push({
      ...candidate,
      role,
      parent_root: role === 'component' ? parent!.root : null,
    });
  }

  return result.sort(compareCandidates);
}

function findAncestorCandidates(
  root: string,
  candidates: Map<string, RepositoryProjectCandidate>,
): RepositoryProjectCandidate[] {
  if (root === '.') {
    return [];
  }

  const segments = root.split('/').filter(Boolean);
  const ancestors: RepositoryProjectCandidate[] = [];

  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const candidate = candidates.get(segments.slice(0, index).join('/'));
    if (candidate) {
      ancestors.push(candidate);
    }
  }

  const selectedRoot = candidates.get('.');
  if (selectedRoot) {
    ancestors.push(selectedRoot);
  }

  return ancestors.sort(compareCandidates);
}

function isLinkedComponent(
  parent: RepositoryProjectCandidate,
  candidate: RepositoryProjectCandidate,
): boolean {
  const candidateName = basename(candidate.root);
  const candidateNodeOnly =
    candidate.ecosystems.length > 0 &&
    candidate.ecosystems.every((ecosystem) => ecosystem === 'node');
  const parentHasNonNode = parent.ecosystems.some((ecosystem) => ecosystem !== 'node');

  return candidateNodeOnly && parentHasNonNode && COMPONENT_DIRECTORY_NAMES.has(candidateName);
}

function buildApplications(projects: RepositoryProjectCandidate[]): RepositoryApplication[] {
  const standaloneRoots = projects
    .filter((project) => project.role === 'standalone')
    .map((project) => project.root);

  return standaloneRoots.map((root) => ({
    root,
    component_roots: projects
      .filter((project) => project.parent_root === root)
      .map((project) => project.root)
      .sort(),
  }));
}

function resolvePrimaryProjectRoot(
  projects: RepositoryProjectCandidate[],
  applications: RepositoryApplication[],
): string | null {
  if (applications.length === 0) {
    return null;
  }

  const byRoot = new Map(projects.map((project) => [project.root, project]));
  return (
    [...applications].sort((left, right) => {
      const leftProject = byRoot.get(left.root);
      const rightProject = byRoot.get(right.root);
      return (
        scoreCandidate(rightProject) - scoreCandidate(leftProject) ||
        compareByRoot(left.root, right.root)
      );
    })[0]?.root ?? null
  );
}

function compareCandidates(
  left: RepositoryProjectCandidate,
  right: RepositoryProjectCandidate,
): number {
  return compareByRoot(left.root, right.root);
}

function compareByRoot(left: string, right: string): number {
  return depthOf(left) - depthOf(right) || left.localeCompare(right);
}

function depthOf(root: string): number {
  return root === '.' ? 0 : root.split('/').filter(Boolean).length;
}

function scoreCandidate(candidate: RepositoryProjectCandidate | undefined): number {
  if (!candidate) {
    return -1;
  }

  return (
    candidate.markers.reduce((score, marker) => score + markerScore(marker), 0) -
    depthOf(candidate.root)
  );
}

function markerScore(marker: string): number {
  switch (marker) {
    case 'composer.json':
    case 'package.json':
    case 'pubspec.yaml':
      return 5;
    case 'artisan':
    case 'manage.py':
      return 4;
    case 'pyproject.toml':
    case 'Gemfile':
    case 'go.mod':
    case 'Cargo.toml':
    case 'pom.xml':
    case 'build.gradle':
    case 'build.gradle.kts':
      return 3;
    default:
      return 1;
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

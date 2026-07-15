import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { dropGitIgnored } from '@/core/fs/gitignore-scan.js';
import { toPosixPath } from '@/core/path-utils.js';
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
  'docs',
  'modules',
  'node_modules',
  'out',
  'target',
  'tests',
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

  // Walk the tree once into memory, then resolve git-ignored paths with a SINGLE
  // batched `git check-ignore` call (issue #386). The previous implementation
  // spawned two `git check-ignore` subprocesses per visited directory, so a
  // large repo stalled onboarding for seconds before the provider prompt.
  const tree = await buildTree(projectRoot, '.', 0, maxDepth);
  const checkPaths = collectCheckPaths(tree);
  const visible = new Set(checkPaths.length > 0 ? dropGitIgnored(projectRoot, checkPaths) : []);
  resolveTree(tree, visible, candidates, ignoredPaths);

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

/**
 * A directory captured during the readdir pass. `markerCandidates`/`markerPaths`
 * are the project markers present in this directory (aligned by index);
 * `staticIgnored` are child paths excluded by the git-independent rules (dot
 * entries and the static ignore/non-canonical sets); `children` are the
 * directories worth resolving, each carrying whether it is a nested VCS boundary.
 */
interface DirNode {
  relativeDir: string;
  markerCandidates: string[];
  markerPaths: string[];
  staticIgnored: string[];
  children: DirChild[];
}

interface DirChild {
  relativePath: string;
  vcsBoundary: boolean;
  node: DirNode;
}

function emptyNode(relativeDir: string): DirNode {
  return { relativeDir, markerCandidates: [], markerPaths: [], staticIgnored: [], children: [] };
}

/**
 * Read the tree once into memory, applying only the git-independent rules (dot
 * entries, static ignore/non-canonical sets, and nested VCS boundaries). No
 * `git check-ignore` runs here — that resolution is batched into a single call
 * by the caller. Descent stops at a nested VCS boundary so we never read an
 * entire nested repository during collection.
 */
async function buildTree(
  projectRoot: string,
  relativeDir: string,
  depth: number,
  maxDepth: number,
): Promise<DirNode> {
  const absoluteDir = relativeDir === '.' ? projectRoot : join(projectRoot, relativeDir);
  const node = emptyNode(relativeDir);
  let entries;

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return node;
  }

  const entryNames = new Set(entries.map((entry) => entry.name));
  node.markerCandidates = Array.from(PROJECT_MARKERS.keys()).filter((marker) =>
    entryNames.has(marker),
  );
  node.markerPaths = node.markerCandidates.map((marker) => repositoryPath(relativeDir, marker));

  if (depth >= maxDepth) {
    return node;
  }

  for (const entry of entries) {
    const childRelativePath = repositoryPath(relativeDir, entry.name);
    if (entry.name.startsWith('.')) {
      node.staticIgnored.push(childRelativePath);
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    if (IGNORED_DIRECTORIES.has(entry.name) || NON_CANONICAL_DIRECTORIES.has(entry.name)) {
      node.staticIgnored.push(childRelativePath);
      continue;
    }

    const vcsBoundary = await hasVcsBoundary(join(absoluteDir, entry.name));
    const childNode = vcsBoundary
      ? emptyNode(childRelativePath)
      : await buildTree(projectRoot, childRelativePath, depth + 1, maxDepth);
    node.children.push({ relativePath: childRelativePath, vcsBoundary, node: childNode });
  }

  return node;
}

/** Flatten every marker and child-directory path so one batched git call covers them all. */
function collectCheckPaths(node: DirNode, out: string[] = []): string[] {
  for (const markerPath of node.markerPaths) {
    out.push(markerPath);
  }
  for (const child of node.children) {
    out.push(child.relativePath);
    collectCheckPaths(child.node, out);
  }
  return out;
}

/**
 * Reproduce the prune-as-you-go output from the precomputed visibility set: a
 * git-ignored or nested-VCS child is recorded in `ignoredPaths` and never
 * descended, so paths beneath it never surface — identical to the previous
 * per-directory walk, but with zero further subprocesses.
 */
function resolveTree(
  node: DirNode,
  visible: Set<string>,
  candidates: Map<string, RepositoryProjectCandidate>,
  ignoredPaths: Set<string>,
): void {
  const markers = node.markerCandidates.filter((_marker, index) => {
    const markerPath = node.markerPaths[index]!;
    if (visible.has(markerPath)) {
      return true;
    }
    ignoredPaths.add(markerPath);
    return false;
  });

  if (markers.length > 0) {
    const ecosystems = Array.from(
      new Set(markers.map((marker) => PROJECT_MARKERS.get(marker)).filter(isDefined)),
    ).sort();
    candidates.set(node.relativeDir, {
      root: node.relativeDir,
      role: 'standalone',
      parent_root: null,
      markers: markers.sort(),
      ecosystems,
    });
  }

  for (const staticIgnoredPath of node.staticIgnored) {
    ignoredPaths.add(staticIgnoredPath);
  }

  for (const child of node.children) {
    if (!visible.has(child.relativePath) || child.vcsBoundary) {
      ignoredPaths.add(child.relativePath);
      continue;
    }

    resolveTree(child.node, visible, candidates, ignoredPaths);
  }
}

function repositoryPath(relativeDir: string, entryName: string): string {
  return toPosixPath(relativeDir === '.' ? entryName : join(relativeDir, entryName));
}

async function hasVcsBoundary(absoluteDir: string): Promise<boolean> {
  try {
    await lstat(join(absoluteDir, '.git'));
    return true;
  } catch {
    return false;
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

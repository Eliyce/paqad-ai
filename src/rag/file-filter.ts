import { existsSync, readFileSync } from 'node:fs';
import { lstat, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, matchesGlob, relative, sep } from 'node:path';

import Ajv from 'ajv';
import fg from 'fast-glob';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { LoadedStackPack } from '@/core/types/pack.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import type { ProviderProgressUpdate } from '@/rag/types.js';

const BASE_EXTENSIONS = new Set(['.md', '.mdx', '.yaml', '.yml', '.json']);

const BASE_BASENAME_INCLUDES = new Set([
  'Dockerfile',
  'Makefile',
  'Gemfile',
  'Rakefile',
  'Procfile',
  'Vagrantfile',
  'Brewfile',
  'Justfile',
  '.dockerignore',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintignore',
  '.gitattributes',
]);

const HARD_LOCKFILE_EXCLUSIONS = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Gemfile.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'gradle.lockfile',
  'Cargo.lock',
  'go.sum',
  'Pipfile.lock',
]);

const AI_TOOL_DIRS = new Set([
  '.claude',
  '.codex',
  '.cursor',
  '.junie',
  '.roo',
  '.cline',
  '.windsurf',
]);

const FALLBACK_ADAPTER_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);

const FRAMEWORK_DEFAULT_EXCLUDE_DIRECTORIES = [
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.dart_tool',
  'Pods',
  '.gradle',
  '.m2',
  'target',
  'pkg',
  '_vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.turbo',
  '.vercel',
  '.netlify',
  'bin',
  'obj',
  'DerivedData',
  '.pnpm-store',
  '.yarn',
  '.yarn-cache',
  '.npm',
  '.cache',
  '.sass-cache',
  '.parcel-cache',
  '.eslintcache',
  '.stylelintcache',
  '.rpt2_cache',
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  'coverage',
  '.nyc_output',
  'htmlcov',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '__snapshots__',
  '_site',
  'storybook-static',
  '.docusaurus',
  'site',
  '.terraform',
  '.vagrant',
  '.idea',
  '.eclipse',
];

const DEFAULT_RAG_IGNORE_CONFIG: RagIgnoreConfig = {
  version: 1,
  exclude: [],
  include: [],
  additional_extensions: [],
  additional_basename_includes: [],
  additional_named_file_exclusions: [],
  use_project_ignore_files: true,
  use_global_gitignore: false,
};

const RAG_IGNORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    version: { type: 'integer', const: 1 },
    exclude: { type: 'array', items: { type: 'string' } },
    include: { type: 'array', items: { type: 'string' } },
    additional_extensions: { type: 'array', items: { type: 'string' } },
    additional_basename_includes: { type: 'array', items: { type: 'string' } },
    additional_named_file_exclusions: { type: 'array', items: { type: 'string' } },
    use_project_ignore_files: { type: 'boolean' },
    use_global_gitignore: { type: 'boolean' },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
const validateRagIgnoreConfig = ajv.compile(RAG_IGNORE_SCHEMA);

export interface RagIgnoreConfig {
  version: 1;
  exclude: string[];
  include: string[];
  additional_extensions: string[];
  additional_basename_includes: string[];
  additional_named_file_exclusions: string[];
  use_project_ignore_files: boolean;
  use_global_gitignore: boolean;
}

export interface FilterDiagnostics {
  extensionAllowlist: string[];
  namedBasenameIncludes: string[];
  directoryExclusionSet: string[];
  hardNamedFileExclusionSet: string[];
}

export interface FileProbeResult {
  path: string;
  excluded: boolean;
  layer?: 1 | 2 | 3 | 4;
  rule?: string;
}

export interface FilterStats {
  total_discovered: number;
  excluded_layer1: number;
  excluded_layer2: number;
  excluded_layer3: number;
  excluded_layer4: number;
  passed: number;
}

export interface RagFileFilterOptions {
  projectRoot: string;
  packs: LoadedStackPack[];
  intelligence?: Partial<IntelligenceConfig>;
}

interface IgnoreRule {
  glob: string;
  source: string;
}

export class RagFileFilter {
  private readonly ragConfig: RagIgnoreConfig;
  private readonly extensionAllowlist: string[];
  private readonly namedBasenameIncludes: Set<string>;
  private readonly directoryExclusionSet: Set<string>;
  private readonly hardNamedFileExclusionSet: Set<string>;
  private readonly adapterFileExclusionSet: Set<string>;
  private readonly diagnosticsSnapshot: FilterDiagnostics;
  private _layer3RulesCache: Promise<IgnoreRule[]> | null = null;

  constructor(private readonly options: RagFileFilterOptions) {
    this.ragConfig = readRagIgnoreConfig(options.projectRoot);
    this.extensionAllowlist = sortExtensionsDescending(
      new Set([
        ...BASE_EXTENSIONS,
        ...options.packs.flatMap((pack) => pack.manifest.ast?.file_extensions ?? []),
        ...this.ragConfig.additional_extensions,
      ]),
    );
    this.namedBasenameIncludes = new Set([
      ...BASE_BASENAME_INCLUDES,
      ...options.packs.flatMap((pack) => pack.manifest.rag?.basename_includes ?? []),
      ...this.ragConfig.additional_basename_includes,
    ]);
    this.directoryExclusionSet = new Set([
      ...FRAMEWORK_DEFAULT_EXCLUDE_DIRECTORIES,
      ...options.packs.flatMap((pack) => pack.manifest.rag?.exclude_directories ?? []),
    ]);
    this.adapterFileExclusionSet = readAdapterFileExclusions(options.projectRoot);
    this.hardNamedFileExclusionSet = new Set([
      ...HARD_LOCKFILE_EXCLUSIONS,
      ...this.ragConfig.additional_named_file_exclusions,
      ...this.adapterFileExclusionSet,
    ]);
    this.diagnosticsSnapshot = {
      extensionAllowlist: [...this.extensionAllowlist],
      namedBasenameIncludes: [...this.namedBasenameIncludes].sort(),
      directoryExclusionSet: [...this.directoryExclusionSet].sort(),
      hardNamedFileExclusionSet: [...this.hardNamedFileExclusionSet].sort(),
    };
  }

  async discoverFiles(onProgress?: (update: ProviderProgressUpdate) => void): Promise<string[]> {
    onProgress?.({
      phase: 'build',
      message: 'Discovering repository files for RAG eligibility',
    });

    const discovered = await fg('**/*', {
      cwd: this.options.projectRoot,
      absolute: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    const sorted = [...discovered].sort();
    const layer3IgnoreRules = await readIgnoreRules(this.options.projectRoot, this.ragConfig);
    const files: string[] = [];
    const stats: FilterStats = {
      total_discovered: sorted.length,
      excluded_layer1: 0,
      excluded_layer2: 0,
      excluded_layer3: 0,
      excluded_layer4: 0,
      passed: 0,
    };

    onProgress?.({
      phase: 'build',
      message: `Filtering ${sorted.length} discovered files with RAG rules`,
      loaded: 0,
      total: sorted.length,
      percent: 0,
    });

    const progressInterval = Math.max(Math.min(Math.floor(sorted.length / 20), 2500), 500);
    for (const [index, absolutePath] of sorted.entries()) {
      const probe = await this.evaluateFile(absolutePath, layer3IgnoreRules);
      if (probe.excluded) {
        if (probe.layer === 1) stats.excluded_layer1 += 1;
        if (probe.layer === 2) stats.excluded_layer2 += 1;
        if (probe.layer === 3) stats.excluded_layer3 += 1;
        if (probe.layer === 4) stats.excluded_layer4 += 1;
      } else {
        stats.passed += 1;
        files.push(absolutePath);
      }

      const processed = index + 1;

      if (processed % progressInterval === 0 || processed === sorted.length) {
        onProgress?.({
          phase: 'build',
          message: `Filtered ${processed}/${sorted.length} files; ${stats.passed} remain eligible`,
          loaded: processed,
          total: sorted.length,
          percent: Math.round((processed / sorted.length) * 100),
        });
      }
    }

    onProgress?.({
      phase: 'build',
      message: `RAG file filtering kept ${stats.passed} eligible files`,
      loaded: sorted.length,
      total: sorted.length,
      percent: 100,
    });

    return files;
  }

  filterDiagnostics(): FilterDiagnostics {
    return this.diagnosticsSnapshot;
  }

  async probeFile(absolutePath: string): Promise<FileProbeResult> {
    const normalizedPath = normalizeAbsolutePath(absolutePath);
    if (!existsSync(normalizedPath)) {
      return {
        path: normalizedPath,
        excluded: true,
        layer: 4,
        rule: 'not-found',
      };
    }

    const layer3IgnoreRules = await this.getLayer3Rules();
    return this.evaluateFile(normalizedPath, layer3IgnoreRules);
  }

  private getLayer3Rules(): Promise<IgnoreRule[]> {
    if (!this._layer3RulesCache) {
      this._layer3RulesCache = readIgnoreRules(this.options.projectRoot, this.ragConfig);
    }
    return this._layer3RulesCache;
  }

  previewIndex(): Promise<string[]> {
    return this.discoverFiles();
  }

  private async evaluateFile(absolutePath: string, layer3IgnoreRules: IgnoreRule[]) {
    const basename = basenameOf(absolutePath);
    const relativePath = toProjectRelativePath(this.options.projectRoot, absolutePath);

    if (!isEligibleByLayer1(basename, this.extensionAllowlist, this.namedBasenameIncludes)) {
      return {
        path: absolutePath,
        excluded: true,
        layer: 1 as const,
        rule: 'ineligible-extension-or-basename',
      };
    }

    const layer2 = isExcludedByLayer2(
      absolutePath,
      basename,
      this.options.projectRoot,
      this.hardNamedFileExclusionSet,
      this.adapterFileExclusionSet,
    );
    if (layer2) {
      return {
        path: absolutePath,
        excluded: true,
        layer: 2 as const,
        rule: layer2,
      };
    }

    const layer3 = this.evaluateLayer3(relativePath, basename, layer3IgnoreRules);
    if (layer3) {
      return {
        path: absolutePath,
        excluded: true,
        layer: 3 as const,
        rule: layer3,
      };
    }

    const layer4 = await this.evaluateLayer4(absolutePath);
    if (layer4) {
      return {
        path: absolutePath,
        excluded: true,
        layer: 4 as const,
        rule: layer4,
      };
    }

    return {
      path: absolutePath,
      excluded: false,
    };
  }

  private evaluateLayer3(relativePath: string, basename: string, ignoreRules: IgnoreRule[]) {
    const includedByConfig = this.ragConfig.include.some((pattern) =>
      matchesProjectGlob(relativePath, pattern),
    );

    const ignoreMatch = ignoreRules.find((rule) => matchesProjectGlob(relativePath, rule.glob));
    if (ignoreMatch && !includedByConfig) {
      return `project-ignore:${ignoreMatch.source}`;
    }

    const defaultDir = findMatchingDirectory(relativePath, FRAMEWORK_DEFAULT_EXCLUDE_DIRECTORIES);
    if (defaultDir && !includedByConfig) {
      return `framework-directory:${defaultDir}`;
    }

    const packDir = findMatchingDirectory(
      relativePath,
      this.options.packs.flatMap((pack) => pack.manifest.rag?.exclude_directories ?? []),
    );
    if (packDir && !includedByConfig) {
      return `pack-directory:${packDir}`;
    }

    const configExclude = this.ragConfig.exclude.find((pattern) =>
      matchesProjectGlob(relativePath, pattern),
    );
    if (configExclude && !includedByConfig) {
      return `config-exclude:${configExclude}`;
    }

    if (isSoftEnvExcluded(basename) && !includedByConfig) {
      return 'soft-env-exclusion';
    }

    return undefined;
  }

  private async evaluateLayer4(absolutePath: string): Promise<string | undefined> {
    try {
      const fileLstat = await lstat(absolutePath);
      if (fileLstat.isSymbolicLink()) {
        return 'symlink';
      }

      const fileStat = await stat(absolutePath);
      const maxFileSize = this.options.intelligence?.rag_max_file_size ?? 153600;

      if (fileStat.size > maxFileSize) {
        return 'size-cap';
      }

      if (fileStat.size === 0) {
        return 'empty-file';
      }

      const preview = await readFile(absolutePath, { encoding: null });
      const prefix = preview.subarray(0, Math.min(8192, preview.length));
      if (prefix.includes(0)) {
        return 'binary-nul-byte';
      }

      const utf8 = preview.toString('utf8');
      if (utf8.includes('\uFFFD')) {
        console.warn(`Skipping non-UTF-8 file: ${absolutePath}`);
        return 'invalid-utf8';
      }

      const nonWhitespaceChars = utf8.replace(/\s/g, '').length;
      if (nonWhitespaceChars < 50) {
        return 'below-minimum-content-threshold';
      }

      return undefined;
    } catch (error) {
      void error;
      console.warn(`Skipping unreadable file: ${absolutePath}`);
      return 'unreadable';
    }
  }
}

function readRagIgnoreConfig(projectRoot: string): RagIgnoreConfig {
  const configPath = join(projectRoot, PATHS.RAG_IGNORE_CONFIG);
  if (!existsSync(configPath)) {
    return { ...DEFAULT_RAG_IGNORE_CONFIG };
  }

  try {
    const parsed = YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    if (!validateRagIgnoreConfig(parsed)) {
      console.warn(`Invalid RAG ignore config at ${configPath}; using defaults`);
      return { ...DEFAULT_RAG_IGNORE_CONFIG };
    }

    return {
      version: 1,
      exclude: [...((parsed.exclude as string[] | undefined) ?? [])],
      include: [...((parsed.include as string[] | undefined) ?? [])],
      additional_extensions: [...((parsed.additional_extensions as string[] | undefined) ?? [])],
      additional_basename_includes: [
        ...((parsed.additional_basename_includes as string[] | undefined) ?? []),
      ],
      additional_named_file_exclusions: [
        ...((parsed.additional_named_file_exclusions as string[] | undefined) ?? []),
      ],
      use_project_ignore_files:
        (parsed.use_project_ignore_files as boolean | undefined) ??
        DEFAULT_RAG_IGNORE_CONFIG.use_project_ignore_files,
      use_global_gitignore:
        (parsed.use_global_gitignore as boolean | undefined) ??
        DEFAULT_RAG_IGNORE_CONFIG.use_global_gitignore,
    };
  } catch {
    console.warn(`Failed to parse RAG ignore config at ${configPath}; using defaults`);
    return { ...DEFAULT_RAG_IGNORE_CONFIG };
  }
}

function readAdapterFileExclusions(projectRoot: string): Set<string> {
  const manifestPath = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  if (!existsSync(manifestPath)) {
    return new Set(FALLBACK_ADAPTER_FILES);
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OnboardingManifest;
    const basenames = manifest.generated_artifacts.map((artifact) => basenameOf(artifact.path));
    return new Set([...basenames, ...FALLBACK_ADAPTER_FILES]);
  } catch {
    return new Set(FALLBACK_ADAPTER_FILES);
  }
}

async function readIgnoreRules(
  projectRoot: string,
  config: RagIgnoreConfig,
): Promise<IgnoreRule[]> {
  if (!config.use_project_ignore_files) {
    return [];
  }

  const projectIgnoreFiles = await fg('**/.gitignore', {
    cwd: projectRoot,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const extraRootFiles = ['.ignore', '.fdignore', '.rgignore']
    .map((name) => join(projectRoot, name))
    .filter((path) => existsSync(path));
  const globalFiles = config.use_global_gitignore
    ? [join(homedir(), '.gitignore_global'), join(homedir(), '.config/git/ignore')].filter((path) =>
        existsSync(path),
      )
    : [];

  const rules: IgnoreRule[] = [];
  for (const file of [...projectIgnoreFiles.sort(), ...extraRootFiles, ...globalFiles]) {
    const fileRelativeDir = file.startsWith(projectRoot)
      ? toPosixPath(relative(projectRoot, file)).split('/').slice(0, -1).join('/')
      : '';
    const baseDir = file.startsWith(projectRoot) ? fileRelativeDir : '';
    const sourceName = file.startsWith(projectRoot)
      ? toPosixPath(relative(projectRoot, file))
      : file;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      if (line.startsWith('!')) {
        continue;
      }

      rules.push(
        ...resolveIgnorePattern(baseDir, line).map((glob) => ({
          glob,
          source: sourceName,
        })),
      );
    }
  }

  return rules;
}

function isEligibleByLayer1(
  basename: string,
  extAllowlist: string[],
  basenameIncludes: Set<string>,
): boolean {
  const lowerBasename = basename.toLowerCase();
  for (const extension of extAllowlist) {
    if (lowerBasename.endsWith(extension.toLowerCase())) {
      return true;
    }
  }

  if (basenameIncludes.has(basename)) {
    return true;
  }

  const stem = basename.split('.')[0];
  return stem.length > 0 && basenameIncludes.has(stem);
}

function isExcludedByLayer2(
  absolutePath: string,
  basename: string,
  projectRoot: string,
  hardExclusions: Set<string>,
  adapterFiles: Set<string>,
): string | undefined {
  const relativePath = toProjectRelativePath(projectRoot, absolutePath);
  const segments = splitSegments(relativePath);

  if (relativePath.startsWith('.paqad/') || segments.includes('.paqad')) {
    return 'framework-output:.paqad';
  }

  const aiToolDir = segments.find((segment) => AI_TOOL_DIRS.has(segment));
  if (aiToolDir) {
    return `ai-tool-directory:${aiToolDir}`;
  }

  if (hardExclusions.has(basename)) {
    return adapterFiles.has(basename) ? `adapter-file:${basename}` : `hard-file:${basename}`;
  }

  return undefined;
}

function findMatchingDirectory(relativePath: string, directories: string[]): string | undefined {
  const segments = splitSegments(relativePath);
  return directories.find((directory) => {
    const normalized = trimSlashes(toPosixPath(directory));
    if (!normalized) {
      return false;
    }

    const dirSegments = normalized.split('/');
    if (dirSegments.length === 1) {
      return segments.includes(dirSegments[0]);
    }

    const relativeDir = dirnameSegments(relativePath);
    return (
      relativeDir === normalized ||
      relativeDir.startsWith(`${normalized}/`) ||
      relativeDir.includes(`/${normalized}/`) ||
      relativeDir.endsWith(`/${normalized}`)
    );
  });
}

function isSoftEnvExcluded(basename: string): boolean {
  return basename === '.env' || basename.startsWith('.env.');
}

function resolveIgnorePattern(baseDir: string, pattern: string): string[] {
  const normalizedBase = trimSlashes(toPosixPath(baseDir));
  const normalizedPattern = trimSlashes(toPosixPath(pattern.replace(/^\.\//, '')));
  if (!normalizedPattern) {
    return [];
  }

  const basePrefix = normalizedBase ? `${normalizedBase}/` : '';
  const directoryPattern = pattern.endsWith('/');
  const candidate = normalizedPattern.replace(/^\/+/, '');

  if (!candidate.includes('/')) {
    if (directoryPattern) {
      return [`${basePrefix}**/${candidate}/**`, `${basePrefix}${candidate}/**`];
    }
    return [`${basePrefix}**/${candidate}`, `${basePrefix}${candidate}`];
  }

  if (directoryPattern) {
    return [`${basePrefix}${candidate}/**`];
  }

  return [`${basePrefix}${candidate}`];
}

function matchesProjectGlob(relativePath: string, pattern: string): boolean {
  const normalizedPath = toPosixPath(relativePath);
  const rawPattern = toPosixPath(pattern);
  const directoryPattern = rawPattern.endsWith('/');
  const normalizedPattern = trimSlashes(rawPattern);
  if (!normalizedPattern) {
    return false;
  }

  const candidates = new Set<string>([normalizedPattern]);
  if (!normalizedPattern.startsWith('**/')) {
    candidates.add(`**/${normalizedPattern}`);
  }
  if (directoryPattern) {
    candidates.add(`${normalizedPattern}/**`);
    candidates.add(`**/${normalizedPattern}/**`);
  }

  return [...candidates].some((candidate) => matchesGlob(normalizedPath, candidate));
}

function basenameOf(path: string): string {
  const normalized = toPosixPath(path);
  const segments = normalized.split('/');
  return segments[segments.length - 1]!;
}

function dirnameSegments(path: string): string {
  const segments = splitSegments(path);
  return segments.slice(0, -1).join('/');
}

function splitSegments(path: string): string[] {
  return toPosixPath(path).split('/').filter(Boolean);
}

function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  return toPosixPath(relative(projectRoot, absolutePath));
}

function normalizeAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function sortExtensionsDescending(extensions: Set<string>): string[] {
  return [...extensions].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

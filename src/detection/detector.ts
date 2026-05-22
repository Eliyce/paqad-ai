import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import type { Capability } from '@/core/types/domain.js';
import type { DetectionSignal, DetectionReport } from '@/core/types/health.js';
import type { RepositoryApplication, RepositoryContext } from '@/core/types/repository.js';
import type {
  LoadedStackPack,
  StackPackDetectionRule,
  StackPackFieldRule,
  StackPackTraitManifest,
} from '@/core/types/pack.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { detectEnvironmentTraits } from '@/introspection/environment-traits.js';
import { StackPackLoader } from '@/packs/loader.js';
import { resolvePackManagerRoots } from '@/packs/manager.js';
import { prefixRepositoryPath } from '@/repository/discovery.js';

import { buildDetectionReport } from './report.js';
import { detectShortVideoSignals } from './signals/short-video.js';

interface MatchedPack {
  name: string;
  score: number;
  priority: number;
  excludes: string[];
  signals: DetectionSignal[];
  traits: string[];
}

interface ApplicationDetectionResult {
  application: RepositoryApplication;
  matches: MatchedPack[];
  detectionPhase: DetectionReport['detection_phase'];
  environment: ReturnType<typeof mergeEnvironmentTraits>;
}

export class Detector {
  private readonly introspector = new StackIntrospector();
  private readonly packLoader = new StackPackLoader();

  async detect(projectRoot: string): Promise<DetectionReport> {
    const snapshot = await this.introspector.snapshot(projectRoot);
    const repository = snapshot.repository ?? emptyRepositoryContext(projectRoot);
    const roots = resolvePackManagerRoots(projectRoot);
    const registry = this.packLoader.load({
      runtimeRoot: roots.runtimeRoot,
      globalPacksRoot: roots.globalPacksRoot,
      projectRoot,
    });

    const allPacks = Array.from(registry.packs.values());
    const frameworkPacks = allPacks.filter((p) => (p.manifest.tier ?? 'framework') === 'framework');
    const archetypePacks = allPacks.filter((p) => p.manifest.tier === 'archetype');

    const applications =
      repository.applications.length > 0
        ? repository.applications
        : [{ root: '.', component_roots: [] }];
    const applicationResults = applications
      .map((application) =>
        detectApplication(
          projectRoot,
          application,
          snapshot.packages,
          frameworkPacks,
          archetypePacks,
        ),
      )
      .sort(compareApplicationResults);
    const primaryResult = applicationResults[0];
    const matchedPacks = primaryResult?.matches ?? [];
    const detectionPhase = primaryResult?.detectionPhase ?? 'none';
    const repositoryEnvironment = mergeEnvironmentTraits(
      projectRoot,
      repository.projects.map((project) => project.root),
      snapshot.packages,
    );

    if (matchedPacks.length === 0) {
      const shortVideoSignals = detectShortVideoSignals(projectRoot);
      if (shortVideoSignals.length > 0) {
        return buildDetectionReport({
          domain: 'content',
          stack: 'short-video',
          matchedPacks: [],
          detectedTraits: [],
          recommendedCapabilities: ['content'],
          detectionPhase: 'none',
          signals: [...shortVideoSignals, ...repositoryEnvironment.signals],
          capabilities: repositoryEnvironment.traits as Capability[],
          confidence: 'low',
          repository,
        });
      }

      return buildDetectionReport({
        domain: null,
        stack: null,
        matchedPacks: [],
        detectedTraits: repositoryEnvironment.traits,
        recommendedCapabilities: ['content'],
        detectionPhase: 'none',
        capabilities: repositoryEnvironment.traits as Capability[],
        signals: repositoryEnvironment.signals,
        confidence: 'low',
        repository,
      });
    }

    const topScore = matchedPacks[0].score;
    const topMatches = matchedPacks.filter((match) => match.score === topScore);
    const ambiguous = topMatches.length > 1;
    const detectedTraits = Array.from(
      new Set([
        ...applicationResults.flatMap((result) => result.matches.flatMap((match) => match.traits)),
        ...repositoryEnvironment.traits,
      ]),
    ).sort();
    const repositoryMatchedPacks = Array.from(
      new Set(applicationResults.flatMap((result) => result.matches.map((match) => match.name))),
    ).sort();
    const confidence = ambiguous
      ? 'low'
      : applicationResults.length > 1
        ? 'medium'
        : scoreToConfidence(topScore);

    return buildDetectionReport({
      domain: ambiguous ? null : 'coding',
      stack: ambiguous ? null : (matchedPacks[0].name as DetectionReport['detected_stack']),
      matchedPacks: repositoryMatchedPacks,
      detectedTraits,
      recommendedCapabilities: ['content', 'coding', 'security'],
      detectionPhase,
      capabilities: detectedTraits.filter(isCapability) as Capability[],
      signals: [
        ...applicationResults.flatMap((result) => result.matches.flatMap((match) => match.signals)),
        ...repositoryEnvironment.signals,
      ],
      confidence,
      repository,
    });
  }
}

function detectApplication(
  projectRoot: string,
  application: RepositoryApplication,
  packages: Array<{ name: string; root?: string }>,
  frameworkPacks: LoadedStackPack[],
  archetypePacks: LoadedStackPack[],
): ApplicationDetectionResult {
  const roots = [application.root, ...application.component_roots];
  const packageNames = new Set(
    packages.filter((pkg) => roots.includes(pkg.root ?? '.')).map((pkg) => pkg.name),
  );
  const environment = mergeEnvironmentTraits(projectRoot, roots, packages);
  const frameworkMatches = frameworkPacks
    .map((pack) => evaluatePack(projectRoot, roots, pack, packageNames))
    .filter((match): match is MatchedPack => match !== null)
    .filter((match, _, matches) => !isExcludedMatch(match, matches))
    .sort(compareMatchedPacks);

  if (frameworkMatches.length > 0) {
    return {
      application,
      matches: frameworkMatches,
      detectionPhase: 'framework',
      environment,
    };
  }

  const archetypeMatches = archetypePacks
    .map((pack) => evaluatePack(projectRoot, roots, pack, packageNames))
    .filter((match): match is MatchedPack => match !== null)
    .filter((match, _, matches) => !isExcludedMatch(match, matches))
    .sort(compareMatchedPacks);

  return {
    application,
    matches: archetypeMatches,
    detectionPhase: archetypeMatches.length > 0 ? 'archetype' : 'none',
    environment,
  };
}

function evaluatePack(
  projectRoot: string,
  roots: string[],
  pack: LoadedStackPack,
  packageNames: Set<string>,
): MatchedPack | null {
  const signals: DetectionSignal[] = [
    ...evaluateRules(
      projectRoot,
      roots,
      pack.manifest.name,
      pack.manifest.detection.manifests,
      packageNames,
    ),
    ...evaluateRules(
      projectRoot,
      roots,
      pack.manifest.name,
      pack.manifest.detection.lockfiles,
      packageNames,
    ),
    ...evaluateRules(
      projectRoot,
      roots,
      pack.manifest.name,
      pack.manifest.detection.heuristics,
      packageNames,
    ),
  ];

  if (signals.length === 0) {
    return null;
  }

  const traitMatches = detectTraits(projectRoot, roots, pack.manifest.traits ?? [], packageNames);
  const allSignals = [...signals, ...traitMatches.signals];

  return {
    name: pack.manifest.name,
    score: allSignals.length,
    priority: pack.manifest.detection.priority ?? 0,
    excludes: pack.manifest.detection.excludes ?? [],
    signals: allSignals,
    traits: traitMatches.names,
  };
}

function evaluateRules(
  projectRoot: string,
  roots: string[],
  implies: string,
  rules: StackPackDetectionRule[] | undefined,
  packageNames: Set<string>,
): DetectionSignal[] {
  return (rules ?? [])
    .map((rule) => evaluateRule(projectRoot, roots, implies, rule, packageNames))
    .filter((signal): signal is DetectionSignal => signal !== null);
}

function evaluateRule(
  projectRoot: string,
  roots: string[],
  implies: string,
  rule: StackPackDetectionRule,
  packageNames: Set<string>,
): DetectionSignal | null {
  const packagesMatched =
    rule.packages === undefined || rule.packages.every((pkg) => packageNames.has(pkg));
  const matchedRoot = roots.find((root) =>
    matchesRuleAtRoot(projectRoot, root, rule, packageNames),
  );

  if (!packagesMatched || matchedRoot === undefined) {
    return null;
  }

  return {
    signal: buildRuleSignal(rule, implies),
    file: prefixRepositoryPath(
      matchedRoot,
      rule.file ?? rule.directory ?? rule.patterns?.[0] ?? 'package metadata',
    ),
    implies,
    confidence:
      rule.file && rule.packages ? 'high' : rule.file || rule.directory ? 'medium' : 'low',
  };
}

function matchesRuleAtRoot(
  projectRoot: string,
  root: string,
  rule: StackPackDetectionRule,
  packageNames: Set<string>,
): boolean {
  const absoluteRoot = root === '.' ? projectRoot : join(projectRoot, root);
  const fileMatched = rule.file ? existsSync(join(absoluteRoot, rule.file)) : true;
  const directoryMatched = rule.directory ? existsSync(join(absoluteRoot, rule.directory)) : true;
  const patternsMatched =
    rule.patterns === undefined ||
    rule.patterns.every((pattern) => fg.sync(pattern, { cwd: absoluteRoot }).length > 0);
  const contentMatched =
    rule.content_match === undefined ||
    (rule.file !== undefined &&
      existsSync(join(absoluteRoot, rule.file)) &&
      readFileSync(join(absoluteRoot, rule.file), 'utf8').includes(rule.content_match));
  const fieldsMatched = evaluateFieldRules(absoluteRoot, rule);
  const fieldAbsentMatched = evaluateFieldAbsentRules(absoluteRoot, rule);
  const packagesMatched =
    rule.packages === undefined || rule.packages.every((pkg) => packageNames.has(pkg));

  return (
    fileMatched &&
    directoryMatched &&
    patternsMatched &&
    contentMatched &&
    fieldsMatched &&
    fieldAbsentMatched &&
    packagesMatched
  );
}

function evaluateFieldRules(projectRoot: string, rule: StackPackDetectionRule): boolean {
  if (!rule.fields?.length) return true;
  if (!rule.file) return false;

  const parsed = parseManifestFile(projectRoot, rule.file);
  if (parsed === null) return false;

  return rule.fields.every((fieldRule) => checkFieldRule(parsed, fieldRule));
}

function evaluateFieldAbsentRules(projectRoot: string, rule: StackPackDetectionRule): boolean {
  if (!rule.field_absent?.length) return true;
  if (!rule.file) return false;

  const parsed = parseManifestFile(projectRoot, rule.file);
  if (parsed === null) return false;

  return rule.field_absent.every((fieldName) => !hasNestedField(parsed, fieldName));
}

function checkFieldRule(manifest: Record<string, unknown>, fieldRule: StackPackFieldRule): boolean {
  const exists = hasNestedField(manifest, fieldRule.name);

  if (fieldRule.presence === 'absent') return !exists;
  if (fieldRule.presence === 'required') return exists;
  if ('value' in fieldRule && fieldRule.value !== undefined) {
    return exists && getNestedField(manifest, fieldRule.name) === fieldRule.value;
  }
  return exists;
}

function hasNestedField(obj: Record<string, unknown>, dotPath: string): boolean {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return false;
    if (!(part in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function getNestedField(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseManifestFile(projectRoot: string, file: string): Record<string, unknown> | null {
  const filePath = join(projectRoot, file);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectTraits(
  projectRoot: string,
  roots: string[],
  traits: StackPackTraitManifest[],
  packageNames: Set<string>,
): { names: string[]; signals: DetectionSignal[] } {
  const names: string[] = [];
  const signals: DetectionSignal[] = [];

  for (const trait of traits) {
    if (trait.detect_package && packageNames.has(trait.detect_package)) {
      names.push(trait.name);
      signals.push({
        signal: `${trait.name} detected from package metadata`,
        file: 'package metadata',
        implies: trait.name,
        confidence: 'medium',
      });
      continue;
    }

    const fileRoot = trait.detect_file
      ? roots.find((root) =>
          existsSync(
            join(root === '.' ? projectRoot : join(projectRoot, root), trait.detect_file!),
          ),
        )
      : undefined;
    if (trait.detect_file && fileRoot) {
      names.push(trait.name);
      signals.push({
        signal: `${trait.name} detected from ${trait.detect_file}`,
        file: prefixRepositoryPath(fileRoot, trait.detect_file),
        implies: trait.name,
        confidence: 'medium',
      });
      continue;
    }

    const directoryRoot = trait.detect_directory
      ? roots.find((root) =>
          existsSync(
            join(root === '.' ? projectRoot : join(projectRoot, root), trait.detect_directory!),
          ),
        )
      : undefined;
    if (trait.detect_directory && directoryRoot) {
      names.push(trait.name);
      signals.push({
        signal: `${trait.name} detected from ${trait.detect_directory}`,
        file: prefixRepositoryPath(directoryRoot, trait.detect_directory),
        implies: trait.name,
        confidence: 'medium',
      });
    }
  }

  return { names: names.sort(), signals };
}

function buildRuleSignal(rule: StackPackDetectionRule, implies: string): string {
  if (rule.file && rule.packages?.length) {
    return `${implies} detected from ${rule.file} package metadata`;
  }
  if (rule.file && rule.fields?.length) {
    return `${implies} detected from ${rule.file} manifest fields`;
  }
  if (rule.file) {
    return `${implies} detected from ${rule.file}`;
  }
  if (rule.directory) {
    return `${implies} detected from ${rule.directory}`;
  }
  if (rule.patterns?.length) {
    return `${implies} detected from ${rule.patterns[0]}`;
  }
  return `${implies} detected from pack heuristics`;
}

function compareMatchedPacks(left: MatchedPack, right: MatchedPack): number {
  return (
    right.priority - left.priority ||
    right.score - left.score ||
    left.name.localeCompare(right.name)
  );
}

function isExcludedMatch(candidate: MatchedPack, matches: MatchedPack[]): boolean {
  return matches.some(
    (match) => match.name !== candidate.name && match.excludes.includes(candidate.name),
  );
}

function compareApplicationResults(
  left: ApplicationDetectionResult,
  right: ApplicationDetectionResult,
): number {
  const leftScore = left.matches[0]?.score ?? -1;
  const rightScore = right.matches[0]?.score ?? -1;

  return rightScore - leftScore || left.application.root.localeCompare(right.application.root);
}

function scoreToConfidence(score: number): DetectionReport['confidence'] {
  if (score >= 2) {
    return 'high';
  }
  return 'low';
}

function mergeEnvironmentTraits(
  projectRoot: string,
  roots: string[],
  packages: Array<{ name: string; root?: string }>,
): ReturnType<typeof detectEnvironmentTraits> {
  const traits = new Set<string>();
  const signals: DetectionSignal[] = [];
  const sources: ReturnType<typeof detectEnvironmentTraits>['sources'] = [];

  for (const root of roots.length > 0 ? roots : ['.']) {
    const packageNames = packages
      .filter((pkg) => (pkg.root ?? '.') === root)
      .map((pkg) => pkg.name);
    const absoluteRoot = root === '.' ? projectRoot : join(projectRoot, root);
    const environment = detectEnvironmentTraits(absoluteRoot, { packageNames });
    for (const trait of environment.traits) {
      traits.add(trait);
    }
    sources.push(
      ...environment.sources.map((source) => ({
        ...source,
        file: prefixRepositoryPath(root, source.file),
      })),
    );
    signals.push(
      ...environment.signals.map((signal) => ({
        ...signal,
        file: prefixRepositoryPath(root, signal.file),
      })),
    );
  }

  return {
    traits: Array.from(traits).sort(),
    sources,
    signals: dedupeSignals(signals),
  };
}

function dedupeSignals(signals: DetectionSignal[]): DetectionSignal[] {
  const seen = new Set<string>();

  return signals.filter((signal) => {
    const key = `${signal.signal}:${signal.file}:${signal.implies}:${signal.confidence}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function emptyRepositoryContext(projectRoot: string): RepositoryContext {
  return {
    selected_root: projectRoot,
    scan_max_depth: 0,
    ignored_paths: [],
    projects: [],
    applications: [],
    primary_project_root: null,
  };
}

function isCapability(value: string): boolean {
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

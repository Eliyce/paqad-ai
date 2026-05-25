import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';

import YAML from 'yaml';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS, REGISTRIES } from '@/core/constants/paths.js';

export interface ModuleFeatureEntry {
  name: string;
  slug: string;
  auto_update_feature_name: boolean;
  derivation: 'user' | 'locked_manifest' | 'codebase_native' | 'inferred' | 'llm';
  confidence: 'high' | 'medium' | 'low';
  source_paths: string[];
}

export interface ModuleMapEntry {
  name: string;
  slug: string;
  auto_update_module_name: boolean;
  derivation: 'user' | 'locked_manifest' | 'codebase_native' | 'inferred' | 'llm';
  confidence: 'high' | 'medium' | 'low';
  source_paths: string[];
  evidence: {
    routes?: string[];
    tables?: string[];
    symbols?: string[];
  };
  features: ModuleFeatureEntry[];
}

export interface ModuleMap {
  version: number;
  last_updated_at: string;
  domain_glossary: {
    preferred_terms: string[];
    synonyms: Record<string, string>;
    notes: string;
  };
  modules: ModuleMapEntry[];
}

const TECHNICAL_LAYER_NAMES = new Set([
  'adapters',
  'api',
  'cache',
  'cli',
  'components',
  'controllers',
  'core',
  'database',
  'hooks',
  'http',
  'https',
  'grpc',
  'rest',
  'graphql',
  'lib',
  'middleware',
  'models',
  'pipeline',
  'providers',
  'queries',
  'repository',
  'resolver',
  'routes',
  'schemas',
  'services',
  'src',
  'types',
  'utils',
  'validators',
]);

/**
 * Names that are technically-flavoured even if not in TECHNICAL_LAYER_NAMES — used to
 * filter signal-extracted names (controllers, models, etc.) which can include framework
 * boilerplate that should not become business modules.
 */
const TECHNICAL_SIGNAL_NAMES = new Set([
  'auth',
  'authorization',
  'authentication',
  'base',
  'abstract',
  'exception',
  'exceptions',
  'error',
  'errors',
  'event',
  'events',
  'listener',
  'listeners',
  'job',
  'jobs',
  'queue',
  'queues',
  'notification',
  'notifications',
  'command',
  'commands',
  'console',
  'helper',
  'helpers',
  'support',
  'trait',
  'traits',
  'interface',
  'interfaces',
  'contract',
  'contracts',
  'migration',
  'migrations',
  'seeder',
  'seeders',
  'seed',
  'test',
  'tests',
  'spec',
  'specs',
  'testing',
  'config',
  'configuration',
  'setting',
  'settings',
  'lang',
  'translation',
  'translations',
  'locale',
  'provider',
  'request',
  'requests',
  'resource',
  'resources',
  'policy',
  'policies',
  'gate',
  'observer',
  'observers',
  'rule',
  'rules',
  'action',
  'actions',
  'handler',
  'handlers',
  'index',
  'main',
  'app',
  'application',
]);

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isBusinessName(name: string): boolean {
  return !TECHNICAL_LAYER_NAMES.has(name.toLowerCase());
}

async function listTopLevelDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Recursively lists all files under `dir` whose name ends with `ext`.
 * Returns paths relative to `dir`.
 */
async function listFilesWithExtension(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name.toString();
      if (entry.isDirectory() && !name.startsWith('.')) {
        const sub = await listFilesWithExtension(join(dir, name), ext);
        results.push(...sub.map((f) => join(name, f)));
      } else if (entry.isFile() && name.endsWith(ext)) {
        results.push(name);
      }
    }
  } catch {
    // directory does not exist — return empty
  }
  return results;
}

function isBusinessSignalName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.length >= 3 && isBusinessName(name) && !TECHNICAL_SIGNAL_NAMES.has(lower);
}

/**
 * Extracts probable business-domain module names from source-file signals (controller,
 * model, service, and page filenames). Used as a fallback before the low-confidence
 * `Core` placeholder when no structural container directory is found.
 */
async function extractModulesFromSignals(
  projectRoot: string,
): Promise<Array<{ name: string; slug: string; paths: string[] }>> {
  const nameMap = new Map<string, string[]>(); // slug → source paths

  function add(rawName: string, sourcePath: string): void {
    if (!isBusinessSignalName(rawName)) return;
    const slug = toSlug(rawName);
    if (!slug) return;
    if (!nameMap.has(slug)) nameMap.set(slug, []);
    nameMap.get(slug)!.push(toPosixPath(sourcePath));
  }

  // PHP Controllers (Laravel, Symfony-style): BillingController.php → Billing
  for (const relDir of [
    'app/Http/Controllers',
    'app/Controllers',
    'src/Controller',
    'src/Controllers',
  ]) {
    const files = await listFilesWithExtension(join(projectRoot, relDir), '.php');
    for (const file of files) {
      const stem = basename(file, '.php').replace(/Controller$/, '');
      add(stem, `${relDir}/${file}`);
    }
  }

  // PHP Models (Laravel): Invoice.php → Invoice
  for (const relDir of ['app/Models', 'app/Entities']) {
    const files = await listFilesWithExtension(join(projectRoot, relDir), '.php');
    for (const file of files) {
      add(basename(file, '.php'), `${relDir}/${file}`);
    }
  }

  // PHP Services: BillingService.php → Billing
  const phpServiceFiles = await listFilesWithExtension(join(projectRoot, 'app/Services'), '.php');
  for (const file of phpServiceFiles) {
    const stem = basename(file, '.php').replace(/Service$/, '') || basename(file, '.php');
    add(stem, `app/Services/${file}`);
  }

  // TypeScript/JavaScript services: BillingService.ts → Billing
  for (const relDir of ['src/services', 'src/modules']) {
    for (const ext of ['.ts', '.js']) {
      const files = await listFilesWithExtension(join(projectRoot, relDir), ext);
      for (const file of files) {
        const stem = basename(file, ext).replace(/Service$/, '') || basename(file, ext);
        add(stem, `${relDir}/${file}`);
      }
    }
  }

  // TypeScript/JavaScript models: Invoice.ts → Invoice
  for (const relDir of ['src/models', 'src/entities']) {
    for (const ext of ['.ts', '.js']) {
      const files = await listFilesWithExtension(join(projectRoot, relDir), ext);
      for (const file of files) {
        add(basename(file, ext), `${relDir}/${file}`);
      }
    }
  }

  // Page/view directories: pages/billing → Billing
  for (const relDir of ['pages', 'src/pages', 'app/pages', 'src/views', 'resources/views']) {
    const dirs = await listTopLevelDirs(join(projectRoot, relDir));
    for (const name of dirs) {
      if (isBusinessSignalName(name)) {
        add(name, `${relDir}/${name}`);
      }
    }
  }

  return Array.from(nameMap.entries()).map(([slug, paths]) => ({
    name: titleCase(slug.replace(/-/g, ' ')),
    slug,
    paths,
  }));
}

export async function generateInitialRegistries(projectRoot: string): Promise<GeneratedFile[]> {
  const modules = await discoverModules(projectRoot);

  return [
    {
      path: '.paqad/indexes/registry-status.json',
      content: JSON.stringify(
        {
          generated: true,
          modules,
          generated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      autoUpdate: true,
    },
    {
      path: PATHS.GLOSSARY,
      content: '# Glossary\n\n',
      autoUpdate: false,
    },
    ...REGISTRIES.map((registry) => ({
      path: join(PATHS.REGISTRIES_DIR, registry),
      content:
        registry === 'module-registry.md' ? buildModuleRegistry(modules) : `# ${registry}\n\n`,
      autoUpdate: false,
    })),
  ];
}

export async function discoverModules(projectRoot: string): Promise<string[]> {
  // Prefer the reviewed module map when it exists
  const map = await loadModuleMap(projectRoot);
  if (map !== null && map.modules.length > 0) {
    return map.modules.map((m) => m.slug);
  }

  // Fall back to folder-based discovery (legacy path — used before map is reviewed)
  const candidates = [
    join(projectRoot, 'docs/modules'),
    join(projectRoot, 'app'),
    join(projectRoot, 'lib'),
    join(projectRoot, 'src'),
  ];
  const modules = new Set<string>(['core']);

  for (const root of candidates) {
    try {
      const entries = await readdir(root, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const name = entry.name;
        if (name !== '' && !name.startsWith('.')) {
          modules.add(name);
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(modules).sort();
}

export async function discoverBusinessModules(
  projectRoot: string,
  /** Explicit module names extracted from the user's request text. These are added with
   *  high confidence before any directory or signal discovery runs. */
  hintModuleNames: string[] = [],
): Promise<ModuleMapEntry[]> {
  const existing = await loadModuleMap(projectRoot);

  // Build a locked-name index from the existing map for preservation
  const lockedModules = new Map<string, ModuleMapEntry>();
  const lockedFeatures = new Map<string, Map<string, ModuleFeatureEntry>>();
  if (existing !== null) {
    for (const mod of existing.modules) {
      if (!mod.auto_update_module_name) {
        lockedModules.set(mod.slug, mod);
      }
      const featureMap = new Map<string, ModuleFeatureEntry>();
      for (const feat of mod.features) {
        if (!feat.auto_update_feature_name) {
          featureMap.set(feat.slug, feat);
        }
      }
      if (featureMap.size > 0) {
        lockedFeatures.set(mod.slug, featureMap);
      }
    }
  }

  const entries: ModuleMapEntry[] = [];

  // 0. Explicit prompt-provided names have the highest discovery priority.
  for (const hint of hintModuleNames) {
    const slug = toSlug(hint);
    if (!slug || entries.some((e) => e.slug === slug)) continue;
    if (lockedModules.has(slug)) {
      entries.push(lockedModules.get(slug)!);
    } else {
      entries.push(buildEntry(hint, slug, 'inferred', 'high', [], lockedFeatures.get(slug)));
    }
  }

  // 1. Codebase-native containers: app/Modules/*, app/Domain/*, etc.
  const nativeModuleDirs = [
    join(projectRoot, 'app', 'Modules'),
    join(projectRoot, 'app', 'Domain'),
    join(projectRoot, 'src', 'modules'),
    join(projectRoot, 'src', 'domain'),
  ];

  for (const dir of nativeModuleDirs) {
    const names = await listTopLevelDirs(dir);
    for (const name of names) {
      if (!isBusinessName(name)) continue;
      const slug = toSlug(name);
      if (lockedModules.has(slug)) {
        entries.push(lockedModules.get(slug)!);
        continue;
      }
      const sourcePath = toPosixPath(join(relative(projectRoot, dir), name));
      entries.push(
        buildEntry(name, slug, 'codebase_native', 'high', [sourcePath], lockedFeatures.get(slug)),
      );
    }
  }

  // 2. Monorepo packages with business-domain names
  const packageDirs = [
    join(projectRoot, 'packages'),
    join(projectRoot, 'apps'),
    join(projectRoot, 'services'),
  ];
  for (const dir of packageDirs) {
    const names = await listTopLevelDirs(dir);
    for (const name of names) {
      if (!isBusinessName(name)) continue;
      const slug = toSlug(name);
      if (entries.some((e) => e.slug === slug)) continue;
      if (lockedModules.has(slug)) {
        entries.push(lockedModules.get(slug)!);
        continue;
      }
      const sourcePath = toPosixPath(join(relative(projectRoot, dir), name));
      entries.push(
        buildEntry(name, slug, 'codebase_native', 'medium', [sourcePath], lockedFeatures.get(slug)),
      );
    }
  }

  // 3. Infer from top-level app/, src/ subdirectories that are business-named
  const inferCandidates = [
    join(projectRoot, 'app'),
    join(projectRoot, 'src'),
    join(projectRoot, 'lib'),
  ];
  for (const dir of inferCandidates) {
    const names = await listTopLevelDirs(dir);
    for (const name of names) {
      if (!isBusinessName(name)) continue;
      const slug = toSlug(name);
      if (entries.some((e) => e.slug === slug)) continue;
      if (lockedModules.has(slug)) {
        entries.push(lockedModules.get(slug)!);
        continue;
      }
      const sourcePath = toPosixPath(join(relative(projectRoot, dir), name));
      entries.push(
        buildEntry(name, slug, 'inferred', 'medium', [sourcePath], lockedFeatures.get(slug)),
      );
    }
  }

  // If directory-based discovery found nothing, extract business names from source-file
  // signals (controllers, models, services, page dirs) before falling back to Core.
  if (entries.length === 0) {
    const signalResults = await extractModulesFromSignals(projectRoot);
    for (const { name, slug, paths } of signalResults) {
      if (lockedModules.has(slug)) {
        entries.push(lockedModules.get(slug)!);
      } else {
        entries.push(buildEntry(name, slug, 'inferred', 'low', paths, lockedFeatures.get(slug)));
      }
    }
  }

  // Re-insert any locked modules that were not encountered during directory or signal
  // discovery. This prevents manually-added or temporarily-absent locked entries from
  // being silently dropped on a foundation rerun.
  for (const [slug, lockedMod] of lockedModules) {
    if (!entries.some((e) => e.slug === slug)) {
      entries.push(lockedMod);
    }
  }

  // Last resort: a single low-confidence placeholder
  if (entries.length === 0) {
    entries.push(buildEntry('Core', 'core', 'inferred', 'low', [], undefined));
  }

  return entries;
}

function buildEntry(
  rawName: string,
  slug: string,
  derivation: ModuleMapEntry['derivation'],
  confidence: ModuleMapEntry['confidence'],
  sourcePaths: string[],
  lockedFeaturesMap?: Map<string, ModuleFeatureEntry>,
): ModuleMapEntry {
  const name = titleCase(rawName);
  const lockedFeaturesList = lockedFeaturesMap ? Array.from(lockedFeaturesMap.values()) : [];
  return {
    name,
    slug,
    auto_update_module_name: true,
    derivation,
    confidence,
    source_paths: sourcePaths,
    evidence: {},
    features: lockedFeaturesList,
  };
}

export async function generateModuleMapYaml(
  projectRoot: string,
  hintModuleNames: string[] = [],
): Promise<string> {
  // Read the raw file first so we can do an in-place Document update that preserves
  // user-owned content (comments, synonyms, glossary edits, unknown keys).
  let existingRaw: string | null;
  try {
    existingRaw = await readFile(join(projectRoot, PATHS.MODULE_MAP), 'utf8');
  } catch {
    existingRaw = null;
  }

  const modules = await discoverBusinessModules(projectRoot, hintModuleNames);

  if (existingRaw !== null) {
    // In-place Document update so the glossary block (user-edited synonyms, notes,
    // preferred_terms, unknown keys, and inline comments) is preserved verbatim.
    const doc = YAML.parseDocument(existingRaw);
    doc.set('last_updated_at', new Date().toISOString());

    // Build a slug-keyed index of existing module YAML nodes.  Reusing these nodes
    // preserves per-module unknown keys (e.g. team_owner) and inline comments.
    const existingSeq = doc.get('modules', true);
    const existingNodesBySlug = new Map<string, YAML.YAMLMap>();
    if (YAML.isSeq(existingSeq)) {
      for (const item of existingSeq.items) {
        if (YAML.isMap(item)) {
          const slug = item.get('slug');
          if (typeof slug === 'string') {
            existingNodesBySlug.set(slug, item as YAML.YAMLMap);
          }
        }
      }
    }

    // Merge newly-discovered modules into the existing YAML nodes.
    const newSeq = new YAML.YAMLSeq();
    for (const mod of modules) {
      const existingNode = existingNodesBySlug.get(mod.slug);
      if (existingNode !== undefined) {
        // Reuse the existing node — unknown keys and comments survive.
        // Auto-updatable fields are refreshed; locked fields are left untouched.
        if (mod.auto_update_module_name) {
          existingNode.set('name', mod.name);
          existingNode.set('derivation', mod.derivation);
          existingNode.set('confidence', mod.confidence);
          existingNode.set('source_paths', mod.source_paths);
        }
        // Features are always kept in sync regardless of lock status.
        existingNode.set('features', mod.features);
        newSeq.add(existingNode);
      } else {
        // New module — no prior YAML node exists; create a fresh one.
        newSeq.add(doc.createNode(mod));
      }
    }

    doc.set('modules', newSeq);
    return doc.toString();
  }

  const map: ModuleMap = {
    version: 1,
    last_updated_at: new Date().toISOString(),
    domain_glossary: {
      preferred_terms: [],
      synonyms: {},
      notes: '',
    },
    modules,
  };
  return serializeModuleMap(map);
}

/**
 * Serialises a ModuleMap to YAML. Uses the `yaml` package so that all fields
 * (glossary synonyms, evidence, features) are written correctly and the output
 * is round-trippable through `loadModuleMap`.
 */
export function serializeModuleMap(map: ModuleMap): string {
  return YAML.stringify(map, { indent: 2, lineWidth: 0 });
}

export async function loadModuleMap(projectRoot: string): Promise<ModuleMap | null> {
  try {
    const raw = await readFile(join(projectRoot, PATHS.MODULE_MAP), 'utf8');
    return parseModuleMapYaml(raw);
  } catch {
    return null;
  }
}

export async function writeModuleMap(projectRoot: string, yaml: string): Promise<void> {
  await writeFile(join(projectRoot, PATHS.MODULE_MAP), yaml, 'utf8');
}

function parseModuleMapYaml(raw: string): ModuleMap {
  const parsed = YAML.parse(raw) as Record<string, unknown>;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid module map YAML: expected a mapping at the document root');
  }

  const glossaryRaw =
    typeof parsed['domain_glossary'] === 'object' && parsed['domain_glossary'] !== null
      ? (parsed['domain_glossary'] as Record<string, unknown>)
      : {};

  const modules: ModuleMapEntry[] = (Array.isArray(parsed['modules']) ? parsed['modules'] : []).map(
    (m: unknown): ModuleMapEntry => {
      const mod = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
      const evidenceRaw =
        typeof mod['evidence'] === 'object' && mod['evidence'] !== null
          ? (mod['evidence'] as Record<string, unknown>)
          : {};
      const features: ModuleFeatureEntry[] = (
        Array.isArray(mod['features']) ? mod['features'] : []
      ).map((f: unknown): ModuleFeatureEntry => {
        const feat = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
        return {
          name: String(feat['name'] ?? ''),
          slug: String(feat['slug'] ?? ''),
          auto_update_feature_name: feat['auto_update_feature_name'] !== false,
          derivation: (feat['derivation'] as ModuleFeatureEntry['derivation']) ?? 'inferred',
          confidence: (feat['confidence'] as ModuleFeatureEntry['confidence']) ?? 'medium',
          source_paths: Array.isArray(feat['source_paths']) ? feat['source_paths'].map(String) : [],
        };
      });
      return {
        name: String(mod['name'] ?? ''),
        slug: String(mod['slug'] ?? ''),
        auto_update_module_name: mod['auto_update_module_name'] !== false,
        derivation: (mod['derivation'] as ModuleMapEntry['derivation']) ?? 'inferred',
        confidence: (mod['confidence'] as ModuleMapEntry['confidence']) ?? 'medium',
        source_paths: Array.isArray(mod['source_paths']) ? mod['source_paths'].map(String) : [],
        evidence: {
          routes: Array.isArray(evidenceRaw['routes'])
            ? evidenceRaw['routes'].map(String)
            : undefined,
          tables: Array.isArray(evidenceRaw['tables'])
            ? evidenceRaw['tables'].map(String)
            : undefined,
          symbols: Array.isArray(evidenceRaw['symbols'])
            ? evidenceRaw['symbols'].map(String)
            : undefined,
        },
        features,
      };
    },
  );

  return {
    version: typeof parsed['version'] === 'number' ? parsed['version'] : 1,
    last_updated_at:
      typeof parsed['last_updated_at'] === 'string'
        ? parsed['last_updated_at']
        : new Date().toISOString(),
    domain_glossary: {
      preferred_terms: Array.isArray(glossaryRaw['preferred_terms'])
        ? (glossaryRaw['preferred_terms'] as unknown[]).map(String)
        : [],
      synonyms:
        typeof glossaryRaw['synonyms'] === 'object' && glossaryRaw['synonyms'] !== null
          ? (glossaryRaw['synonyms'] as Record<string, string>)
          : {},
      notes: typeof glossaryRaw['notes'] === 'string' ? glossaryRaw['notes'] : '',
    },
    modules,
  };
}

function buildModuleRegistry(modules: string[]): string {
  return ['# module-registry.md', '', ...modules.map((module) => `- ${module}`), ''].join('\n');
}

// The production SiteMapGatherer: wires the real world (the target project's package
// manifest, source tree, the persisted map, and the journeys on disk) into the offline
// facts the pure engine consumes. Like the codebase-health gatherer this file is excluded
// from coverage: its work is real filesystem scanning the unit suite cannot exercise, while
// the pure logic it feeds (extractNodeCliSurfaces / extractGenericSurfaces / assembleExtraction
// and the whole orchestrator) is fully covered on its own through an injected fake gatherer.
//
// It introspects the TARGET project at `projectRoot` (never paqad-ai's own program): a
// commander-based CLI is read statically from its source, a web app falls back to a
// convention scan, and a shape with no deterministic extractor in P1 is recorded as a
// blocked check (FR-3) so the gap is visible rather than a silent pass.

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import fg from 'fast-glob';

import { toPosixPath } from '@/core/path-utils.js';
import type { AppKind, AppMap, Evidence } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';

import {
  blockedExtractor,
  extractGenericSurfaces,
  extractNodeCliSurfaces,
  type CliCommandRecord,
  type ExtractorOutput,
  type GenericSurfaceRecord,
} from './extraction.js';
import type { SiteMapGatherer } from './run.js';
import { listJourneyIds, readAppMap } from './store.js';
import type { EvidenceResolution } from './verification.js';

/** A dependency name → the app kind it implies, most specific first. */
interface FrameworkSignal {
  dep: string;
  kind: AppKind;
}

// Ordered so the first match wins: a Next.js app that also depends on express reads as web.
const FRAMEWORK_SIGNALS: FrameworkSignal[] = [
  { dep: 'electron', kind: 'desktop' },
  { dep: 'react-native', kind: 'mobile' },
  { dep: 'expo', kind: 'mobile' },
  { dep: 'next', kind: 'web' },
  { dep: 'gatsby', kind: 'web' },
  { dep: 'astro', kind: 'web' },
  { dep: '@remix-run/react', kind: 'web' },
  { dep: '@sveltejs/kit', kind: 'web' },
  { dep: 'vue', kind: 'web' },
  { dep: 'svelte', kind: 'web' },
  { dep: '@nestjs/core', kind: 'api' },
  { dep: 'express', kind: 'api' },
  { dep: 'fastify', kind: 'api' },
  { dep: 'koa', kind: 'api' },
  { dep: 'hono', kind: 'api' },
  { dep: 'commander', kind: 'cli' },
  { dep: 'yargs', kind: 'cli' },
  { dep: 'oclif', kind: 'cli' },
];

/** Source-tree globs shared by both scanners; node_modules and build output are never surfaces. */
const SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs}'];
const SOURCE_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/tests/**',
  '**/__tests__/**',
];

/** Cap the scanned file set so a giant monorepo cannot make a run pathological. */
const MAX_SCANNED_FILES = 4000;

interface PackageManifest {
  name?: string;
  bin?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Read the target project's package.json, or an empty manifest when it is missing/corrupt. */
function readManifest(projectRoot: string): PackageManifest {
  try {
    return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return {};
  }
}

/** Every declared dependency name across the three dependency maps. */
function dependencyNames(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

/** Pick the primary app kind from the manifest; a `bin` with no framework signal is a CLI. */
function detectAppKind(manifest: PackageManifest, deps: Set<string>): AppKind {
  for (const signal of FRAMEWORK_SIGNALS) {
    if (deps.has(signal.dep)) return signal.kind;
  }
  if (manifest.bin !== undefined) return 'cli';
  return 'service';
}

/** The framework names present, in signal order, for the run header. */
function detectFrameworks(deps: Set<string>): string[] {
  const seen = new Set<string>();
  const frameworks: string[] = [];
  for (const signal of FRAMEWORK_SIGNALS) {
    if (deps.has(signal.dep) && !seen.has(signal.dep)) {
      seen.add(signal.dep);
      frameworks.push(signal.dep);
    }
  }
  return frameworks;
}

/** 1-indexed line number of a character offset in `content`. */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

const COMMAND_RE = /(?:new Command\(|\.command\()\s*(['"`])([^'"`]+)\1/g;
const DESCRIBE_RE = /\.description\(\s*(['"`])([^'"`]*)\1/;

/**
 * Statically read commander command registrations from one source file: each `new Command('x')`
 * or `.command('x')` becomes a record, paired with the nearest following `.description(...)` so
 * the modeling stage inherits a human label. Evidence is the real file:line of the registration.
 */
function scanFileForCommands(relFile: string, content: string): CliCommandRecord[] {
  const records: CliCommandRecord[] = [];
  COMMAND_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMAND_RE.exec(content)) !== null) {
    const name = match[2]!.trim();
    if (name.length === 0) continue;
    // Look at the chain immediately after the registration for its description.
    const tail = content.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const describe = DESCRIBE_RE.exec(tail);
    records.push({
      name,
      ...(describe && describe[2]!.length > 0 ? { description: describe[2] } : {}),
      file: relFile,
      line: lineOf(content, match.index),
    });
  }
  return records;
}

/** Scan the whole target tree for commander commands, deduping by `name` (first file wins). */
async function scanCliCommands(projectRoot: string): Promise<CliCommandRecord[]> {
  const files = (
    await fg(SOURCE_GLOBS, { cwd: projectRoot, ignore: SOURCE_IGNORE, dot: false })
  ).slice(0, MAX_SCANNED_FILES);
  const byName = new Map<string, CliCommandRecord>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    if (!content.includes('Command(')) continue;
    for (const record of scanFileForCommands(toPosixPath(file), content)) {
      if (!byName.has(record.name)) byName.set(record.name, record);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// A leaf route file under a framework routing convention → one page surface.
const ROUTE_CONVENTIONS = [
  '**/app/**/page.{tsx,jsx,ts,js}', // Next.js app router
  '**/pages/**/*.{tsx,jsx}', // Next.js / Nuxt pages router
  '**/src/routes/**/+page.{svelte,ts,js}', // SvelteKit
];
const ROUTE_EXCLUDE = new Set(['_app', '_document', '_error']);

/** Best-effort convention scan for web apps without a dedicated deterministic extractor. */
async function scanGenericSurfaces(projectRoot: string): Promise<GenericSurfaceRecord[]> {
  const files = (
    await fg(ROUTE_CONVENTIONS, { cwd: projectRoot, ignore: SOURCE_IGNORE, dot: false })
  ).slice(0, MAX_SCANNED_FILES);
  const records: GenericSurfaceRecord[] = [];
  for (const file of files) {
    const rel = toPosixPath(file);
    if (ROUTE_EXCLUDE.has(basename(rel).replace(/\.[^.]+$/, ''))) continue;
    records.push({ kind: 'page', identifier: rel, file: rel });
  }
  return records;
}

/**
 * Resolve one cited pointer against the tree: the file must exist, and a cited line must fall
 * within it. A missing file reads as `file-missing`, an out-of-range line as `line-missing`.
 */
function resolvePointer(projectRoot: string, pointer: Evidence): EvidenceResolution {
  let content: string;
  try {
    content = readFileSync(join(projectRoot, pointer.file), 'utf8');
  } catch {
    return { file: pointer.file, line: pointer.line, status: 'file-missing' };
  }
  if (pointer.line === undefined) {
    return { file: pointer.file, status: 'resolved' };
  }
  const lineCount = content.split('\n').length;
  const inRange = pointer.line >= 1 && pointer.line <= lineCount;
  return { file: pointer.file, line: pointer.line, status: inRange ? 'resolved' : 'line-missing' };
}

/** Wire the real world: read the manifest, the map, the journeys, and run the extractors. */
export function createSiteMapGatherer(projectRoot: string): SiteMapGatherer {
  const manifest = readManifest(projectRoot);
  const deps = dependencyNames(manifest);
  const appKind = detectAppKind(manifest, deps);
  const frameworks = detectFrameworks(deps);
  const name = manifest.name ?? basename(projectRoot);
  const isNodeCli = appKind === 'cli' || deps.has('commander');

  return {
    appKind: () => appKind,
    appSummary: (): SiteMapAppSummary => ({ name, kind: appKind, frameworks }),
    loadAppMap: (): AppMap | null => readAppMap(projectRoot),
    journeyCount: () => listJourneyIds(projectRoot).length,
    resolveEvidence: (pointers: Evidence[]): EvidenceResolution[] =>
      pointers.map((pointer) => resolvePointer(projectRoot, pointer)),
    async extractors(): Promise<ExtractorOutput[]> {
      const outputs: ExtractorOutput[] = [];
      if (isNodeCli) {
        outputs.push({
          extractor: 'node-cli',
          available: true,
          surfaces: extractNodeCliSurfaces(await scanCliCommands(projectRoot)),
        });
      }
      const generic = await scanGenericSurfaces(projectRoot);
      if (generic.length > 0) {
        outputs.push({
          extractor: 'generic',
          available: true,
          surfaces: extractGenericSurfaces(generic),
        });
      }
      // Nothing deterministic ran on a non-CLI shape: record the gap rather than pass silently.
      if (outputs.length === 0 && appKind !== 'service') {
        outputs.push(
          blockedExtractor(
            `${appKind}-surfaces`,
            `no deterministic ${appKind} surface extractor ships in this release`,
            'Author an app-map.yaml by hand, or wait for the dedicated extractor.',
          ),
        );
      }
      return outputs;
    },
  };
}

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

import { execa } from 'execa';
import fg from 'fast-glob';

import { toPosixPath } from '@/core/path-utils.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { AppKind, AppMap, Evidence } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';

import {
  blockedExtractor,
  extractGenericSurfaces,
  extractLaravelArtisanRoutes,
  extractLaravelConsoleCommands,
  extractLaravelJobs,
  extractLaravelMailables,
  extractLaravelRouteSurfaces,
  extractLaravelScheduledJobs,
  extractNodeCliSurfaces,
  extractReactRouteSurfaces,
  parseArtisanCommandList,
  parseArtisanRouteList,
  parseArtisanScheduleList,
  type CliCommandRecord,
  type ExtractedSurface,
  type ExtractorOutput,
  type GenericSurfaceRecord,
  type LaravelClassSurfaceRecord,
  type LaravelRouteRecord,
  type ReactRouteRecord,
  unresolvedBlockedCheck,
} from './extraction.js';
import {
  createArtisanRouteResolver,
  extractConsoleCommandNames,
  findScheduleLine,
  parseComposerPsr4,
  parseVendorPsr4,
  resolveArtisanInvocation,
  scheduledCommandName,
  type ReadProjectFile,
  type SourcePointer,
} from './laravel-sources.js';
import type { SiteMapGatherer } from './run.js';
import { readAllJourneys, readCanonicalSiteMap } from './store.js';
import {
  detectLaravelTransitions,
  detectNodeCliTransitions,
  detectReactRouterTransitions,
  type ExtractedTransition,
  type TransitionSourceRecord,
} from './transitions.js';
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

// React Router: `<Route path="/x" element={<Comp/>} />` or a route object `{ path: '/x', ... }`.
const REACT_JSX_ROUTE_RE =
  /<Route\b[^>]*\bpath=(['"])([^'"]+)\1[^>]*?(?:element=\{<\s*([A-Za-z0-9_]+))?/g;
const REACT_OBJECT_ROUTE_RE =
  /\bpath:\s*(['"])([^'"]+)\1\s*,\s*(?:element:\s*<\s*([A-Za-z0-9_]+))?/g;

/** Statically read React Router route declarations from one source file. */
function scanFileForReactRoutes(relFile: string, content: string): ReactRouteRecord[] {
  const records: ReactRouteRecord[] = [];
  for (const re of [REACT_JSX_ROUTE_RE, REACT_OBJECT_ROUTE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const path = match[2]!.trim();
      if (path.length === 0) continue;
      records.push({
        path,
        ...(match[3] ? { component: match[3] } : {}),
        file: relFile,
        line: lineOf(content, match.index),
      });
    }
  }
  return records;
}

/** Scan the tree for React Router routes, deduping by `path` (first file wins). */
async function scanReactRoutes(projectRoot: string): Promise<ReactRouteRecord[]> {
  const files = (
    await fg(['**/*.{tsx,jsx,ts,js}'], { cwd: projectRoot, ignore: SOURCE_IGNORE, dot: false })
  ).slice(0, MAX_SCANNED_FILES);
  const byPath = new Map<string, ReactRouteRecord>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    if (!content.includes('path')) continue;
    for (const record of scanFileForReactRoutes(toPosixPath(file), content)) {
      if (!byPath.has(record.path)) byPath.set(record.path, record);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// Laravel: `Route::get('/x', Controller::class)` — the method and the uri literal.
const LARAVEL_ROUTE_RE =
  /Route::(get|post|put|patch|delete|options|any|match)\s*\(\s*(?:\[[^\]]*\]\s*,\s*)?(['"])([^'"]+)\2/g;

/** Statically read Laravel route declarations from one PHP route file. */
function scanFileForLaravelRoutes(relFile: string, content: string): LaravelRouteRecord[] {
  const records: LaravelRouteRecord[] = [];
  LARAVEL_ROUTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LARAVEL_ROUTE_RE.exec(content)) !== null) {
    const uri = match[3]!.trim();
    if (uri.length === 0) continue;
    records.push({
      method: match[1]!.toUpperCase(),
      uri,
      file: relFile,
      line: lineOf(content, match.index),
    });
  }
  return records;
}

// Route files live in `routes/` for a classic app, and inside modules for nwidart/bespoke
// layouts — so the static fallback walks module directories too, not just `routes/`.
const LARAVEL_ROUTE_GLOBS = [
  'routes/**/*.php',
  'Modules/*/Routes/**/*.php',
  'Modules/*/routes/**/*.php',
  'Modules/*/app/routes/**/*.php',
  'app/Modules/*/Routes/**/*.php',
  'app/Modules/*/routes/**/*.php',
];

/** Scan a Laravel project's route files (classic + modular) for `Route::` declarations. */
async function scanLaravelRoutes(projectRoot: string): Promise<LaravelRouteRecord[]> {
  const files = await fg(LARAVEL_ROUTE_GLOBS, {
    cwd: projectRoot,
    ignore: ['**/vendor/**'],
    dot: false,
  });
  const records: LaravelRouteRecord[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    records.push(...scanFileForLaravelRoutes(toPosixPath(file), content));
  }
  return records;
}

/** Best-effort timeout for booting artisan — a slow/hung boot must degrade, not stall the run. */
const ARTISAN_TIMEOUT_MS = 20_000;

/**
 * Run a read-only artisan command in the target project the way the project runs artisan
 * (`invocation`, e.g. `vendor/bin/sail artisan`), timeout-bounded. Returns whether it exited
 * cleanly and its stdout. Any failure (no PHP, boot error, timeout) resolves to `ok:false` so the
 * caller degrades to the static scan and records a blocked check — it never throws.
 */
async function runArtisan(
  projectRoot: string,
  invocation: string[],
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const [bin, ...prefix] = invocation;
    const result = await execa(bin!, [...prefix, ...args], {
      cwd: projectRoot,
      reject: false,
      timeout: ARTISAN_TIMEOUT_MS,
    });
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1;
    return { ok: exitCode === 0, stdout: result.stdout ?? '' };
  } catch {
    return { ok: false, stdout: '' };
  }
}

// Queued jobs and mailables are not registered like routes, so there is no artisan "list jobs";
// they need a static scan — but a modular-aware one that also walks module directories.
const LARAVEL_JOB_GLOBS = [
  'app/Jobs/**/*.php',
  'Modules/*/Jobs/**/*.php',
  'Modules/*/app/Jobs/**/*.php',
  'app/Modules/*/Jobs/**/*.php',
];
const LARAVEL_MAIL_GLOBS = [
  'app/Mail/**/*.php',
  'app/Notifications/**/*.php',
  'Modules/*/Mail/**/*.php',
  'Modules/*/app/Mail/**/*.php',
  'Modules/*/Notifications/**/*.php',
  'app/Modules/*/Mail/**/*.php',
];

// A `ShouldQueue` job, or a `Mailable`/`Notification` class — the class marker per family.
const JOB_MARKER_RE = /\bimplements\b[^{]*\bShouldQueue\b/;
const MAIL_MARKER_RE = /\bextends\s+(?:Mailable|Notification)\b/;
const PHP_CLASS_RE = /\bclass\s+([A-Za-z0-9_]+)/;
/** The owning module in a `Modules/<Name>/` or `app/Modules/<Name>/` path. */
const MODULE_PATH_RE = /(?:^|\/)(?:app\/)?Modules\/([^/]+)\//;

/** The owning module from a scanned class file path, when it lives under a module directory. */
function moduleFromPath(relFile: string): string | undefined {
  const match = MODULE_PATH_RE.exec(relFile);
  return match ? match[1] : undefined;
}

/** Scan a family of class files (jobs, mailables) whose content matches `marker`. */
async function scanLaravelClasses(
  projectRoot: string,
  globs: string[],
  marker: RegExp,
): Promise<LaravelClassSurfaceRecord[]> {
  const files = await fg(globs, { cwd: projectRoot, ignore: ['**/vendor/**'], dot: false });
  const records: LaravelClassSurfaceRecord[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    if (!marker.test(content)) continue;
    const classMatch = PHP_CLASS_RE.exec(content);
    if (!classMatch) continue;
    const rel = toPosixPath(file);
    const module = moduleFromPath(rel);
    records.push({
      className: classMatch[1]!,
      file: rel,
      line: lineOf(content, classMatch.index),
      ...(module ? { module } : {}),
    });
  }
  return records;
}

/** Read a project-relative file, or null when it is missing or unreadable (a directory, say). */
function projectFileReader(projectRoot: string): ReadProjectFile {
  return (path) => {
    try {
      return readFileSync(join(projectRoot, path), 'utf8');
    } catch {
      return null;
    }
  };
}

// Console commands the project itself declares (issue #500). Anything artisan lists that is not
// declared here is a framework or package built-in and is not an app surface.
const LARAVEL_CONSOLE_GLOBS = [
  'app/Console/Commands/**/*.php',
  'Modules/*/Console/**/*.php',
  'Modules/*/app/Console/**/*.php',
  'routes/console.php',
];
// Where a Laravel app defines its schedule, across Laravel 10 (Kernel) and 11+ (console/bootstrap).
const LARAVEL_SCHEDULE_FILES = [
  'routes/console.php',
  'bootstrap/app.php',
  'app/Console/Kernel.php',
];

/** Map each console command name declared in project source to its declaration (first wins). */
async function scanConsoleDeclarations(
  projectRoot: string,
  read: ReadProjectFile,
): Promise<Map<string, SourcePointer>> {
  const files = await fg(LARAVEL_CONSOLE_GLOBS, {
    cwd: projectRoot,
    ignore: ['**/vendor/**'],
    dot: false,
  });
  const byName = new Map<string, SourcePointer>();
  for (const file of files.map(toPosixPath).sort()) {
    const content = read(file);
    if (content === null) continue;
    for (const declaration of extractConsoleCommandNames(content)) {
      if (!byName.has(declaration.name)) {
        byName.set(declaration.name, { file, line: declaration.line });
      }
    }
  }
  return byName;
}

/** PSR-4 entries from the project's composer.json, then composer's generated vendor class map. */
function readPsr4(read: ReadProjectFile): ReturnType<typeof parseComposerPsr4> {
  return [
    ...parseComposerPsr4(read('composer.json') ?? ''),
    ...parseVendorPsr4(read('vendor/composer/autoload_psr4.php') ?? ''),
  ];
}

/**
 * Wire every Laravel extractor: prefer artisan introspection (the real router resolves modules,
 * middleware, and controllers), run the way the onboarded project runs artisan (its profile's
 * migrate command: Sail, docker compose, or host PHP), and trace every record back to project
 * source so each surface's evidence is a real `file:line` (issue #500). The static route scan is
 * the fallback, with a labelled blocked check, when artisan cannot run. Queued jobs and mailables
 * have no artisan listing, so they are always the static class scan.
 */
async function laravelExtractors(projectRoot: string): Promise<ExtractorOutput[]> {
  const outputs: ExtractorOutput[] = [];
  const read = projectFileReader(projectRoot);
  // Never rewrite the profile from a site-map run (INV-8): read it without persisting a migration.
  const profile = readProjectProfile(projectRoot, { persistMigration: false });
  const invocation = resolveArtisanInvocation(profile?.commands);
  const staticRoutes = await scanLaravelRoutes(projectRoot);
  const pushStaticRoutes = (): void => {
    if (staticRoutes.length > 0) {
      outputs.push({
        extractor: 'laravel-routes',
        available: true,
        surfaces: extractLaravelRouteSurfaces(staticRoutes),
      });
    }
  };

  if ('blocked' in invocation) {
    pushStaticRoutes();
    outputs.push(
      blockedExtractor(
        'laravel-artisan-routes',
        `artisan was not run because ${invocation.blocked}`,
        'Fix the command named above so routes, console commands and schedules are read from the real app; the static route scan ran as a fallback.',
      ),
    );
  } else {
    const artisan = invocation.argv;
    // Console commands are declared once and read by both the command list and the schedule.
    let declarations: Promise<Map<string, SourcePointer>> | undefined;
    const consoleDeclarations = (): Promise<Map<string, SourcePointer>> =>
      (declarations ??= scanConsoleDeclarations(projectRoot, read));
    const routeRun = await runArtisan(projectRoot, artisan, ['route:list', '--json']);
    if (routeRun.ok) {
      const routes = parseArtisanRouteList(routeRun.stdout);
      const traced = extractLaravelArtisanRoutes(
        routes,
        createArtisanRouteResolver({ psr4: readPsr4(read), staticRoutes, readFile: read }),
      );
      const blocked = unresolvedBlockedCheck(
        'laravel-artisan-routes',
        'routes',
        traced.unresolved,
        ' (closures or package routes)',
      );
      if (traced.surfaces.length > 0 || blocked) {
        outputs.push({
          extractor: 'laravel-artisan-routes',
          available: true,
          surfaces: traced.surfaces,
          blocked,
        });
      }
    } else {
      pushStaticRoutes();
      outputs.push(
        blockedExtractor(
          'laravel-artisan-routes',
          `${artisan.join(' ')} route:list --json did not run (PHP or the container is not available, or the app failed to boot)`,
          `Make sure \`${artisan.join(' ')} route:list --json\` runs in this project so modular routes and middleware are mapped; the static route scan ran as a fallback.`,
        ),
      );
    }

    const listRun = await runArtisan(projectRoot, artisan, ['list', '--format=json']);
    if (listRun.ok) {
      const declared = await consoleDeclarations();
      const surfaces = extractLaravelConsoleCommands(
        parseArtisanCommandList(listRun.stdout),
        (name) => declared.get(name),
      );
      if (surfaces.length > 0) {
        outputs.push({ extractor: 'laravel-console', available: true, surfaces });
      }
    }

    const scheduleRun = await runArtisan(projectRoot, artisan, ['schedule:list']);
    if (scheduleRun.ok) {
      const scheduleSources = LARAVEL_SCHEDULE_FILES.flatMap((file) => {
        const content = read(file);
        return content === null ? [] : [{ file, content }];
      });
      const declared = await consoleDeclarations();
      const traced = extractLaravelScheduledJobs(
        parseArtisanScheduleList(scheduleRun.stdout),
        (command) => {
          // A command scheduled by class (`Schedule::command(SendReports::class)`) is found
          // through the class that declares its name.
          const declaration = declared.get(scheduledCommandName(command));
          const commandClass = declaration ? basename(declaration.file, '.php') : undefined;
          for (const source of scheduleSources) {
            const line = findScheduleLine(source.content, command, commandClass);
            if (line !== undefined) return { file: source.file, line };
          }
          return undefined;
        },
      );
      const blocked = unresolvedBlockedCheck(
        'laravel-schedule',
        'scheduled tasks',
        traced.unresolved,
      );
      if (traced.surfaces.length > 0 || blocked) {
        outputs.push({
          extractor: 'laravel-schedule',
          available: true,
          surfaces: traced.surfaces,
          blocked,
        });
      }
    }
  }

  const jobs = await scanLaravelClasses(projectRoot, LARAVEL_JOB_GLOBS, JOB_MARKER_RE);
  if (jobs.length > 0) {
    outputs.push({
      extractor: 'laravel-jobs',
      available: true,
      surfaces: extractLaravelJobs(jobs),
    });
  }
  const mailables = await scanLaravelClasses(projectRoot, LARAVEL_MAIL_GLOBS, MAIL_MARKER_RE);
  if (mailables.length > 0) {
    outputs.push({
      extractor: 'laravel-mail',
      available: true,
      surfaces: extractLaravelMailables(mailables),
    });
  }

  return outputs;
}

/** True when the project declares Laravel (composer requires laravel/framework). */
function isLaravelProject(projectRoot: string): boolean {
  try {
    const composer = JSON.parse(readFileSync(join(projectRoot, 'composer.json'), 'utf8')) as {
      require?: Record<string, string>;
    };
    return composer.require?.['laravel/framework'] !== undefined;
  } catch {
    return false;
  }
}

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

/**
 * Gather raw navigation edges from the extracted surfaces (S9b, the impure half of transition
 * detection). For each surface it reads that surface's on-disk evidence file(s) — including the
 * route file and controller an artisan route cites; a vanished file reads as unavailable and is
 * skipped — normalises the bytes into a `TransitionSourceRecord` attributed to the surface's
 * `raw_id`, and runs all three S9a detectors over it. The detectors match navigation call
 * syntax, so a PHP controller yields only Laravel edges and a React component only React-Router
 * edges; running all three is safe and keeps the gatherer stack-agnostic. Each distinct file is read once even when several surfaces
 * cite it, and every surface citing it gets its own attributed records. Pure resolution of these
 * raw edges to surfaces is `resolveTransitions`; this function is the coverage-excluded I/O seam.
 */
export function gatherSiteMapTransitions(
  projectRoot: string,
  surfaces: ExtractedSurface[],
): ExtractedTransition[] {
  const fileCache = new Map<string, string | null>();
  const readSource = (file: string): string | null => {
    const cached = fileCache.get(file);
    if (cached !== undefined) return cached;
    let content: string | null;
    try {
      content = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      content = null;
    }
    fileCache.set(file, content);
    return content;
  };

  const records: TransitionSourceRecord[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    for (const evidence of surface.evidence) {
      const key = `${surface.raw_id} ${evidence.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = readSource(evidence.file);
      if (content === null) continue;
      records.push({ from_raw_id: surface.raw_id, file: evidence.file, content });
    }
  }

  return [
    ...detectLaravelTransitions(records),
    ...detectReactRouterTransitions(records),
    ...detectNodeCliTransitions(records),
  ];
}

/** Wire the real world: read the manifest, the map, the journeys, and run the extractors. */
export function createSiteMapGatherer(projectRoot: string): SiteMapGatherer {
  const manifest = readManifest(projectRoot);
  const deps = dependencyNames(manifest);
  const appKind = detectAppKind(manifest, deps);
  const frameworks = detectFrameworks(deps);
  const name = manifest.name ?? basename(projectRoot);
  const isNodeCli = appKind === 'cli' || deps.has('commander');
  const isReactRouter = deps.has('react-router-dom') || deps.has('react-router');
  const isLaravel = isLaravelProject(projectRoot);

  return {
    appKind: () => appKind,
    appSummary: (): SiteMapAppSummary => ({ name, kind: appKind, frameworks }),
    // Issue #466, C8b: read the SINGLE canonical map + journeys under docs/site-map/, so the
    // live run verifies, resolves evidence for, and restamps (C8a) exactly the map the dashboard
    // renders statically.
    loadAppMap: (): AppMap | null => readCanonicalSiteMap(projectRoot),
    journeyCount: () => readAllJourneys(projectRoot).length,
    resolveEvidence: (pointers: Evidence[]): EvidenceResolution[] =>
      pointers.map((pointer) => resolvePointer(projectRoot, pointer)),
    // S9c: the run's transition seam delegates to the S9b detector-over-source-files gatherer, so
    // `sitemap run` reconciles the code's proven edges against the stored map (this is the impure
    // I/O half; resolution and reconciliation are pure in `assemble`).
    gatherTransitions: (surfaces: ExtractedSurface[]): ExtractedTransition[] =>
      gatherSiteMapTransitions(projectRoot, surfaces),
    async extractors(): Promise<ExtractorOutput[]> {
      const outputs: ExtractorOutput[] = [];
      if (isNodeCli) {
        outputs.push({
          extractor: 'node-cli',
          available: true,
          surfaces: extractNodeCliSurfaces(await scanCliCommands(projectRoot)),
        });
      }
      if (isReactRouter) {
        const routes = await scanReactRoutes(projectRoot);
        if (routes.length > 0) {
          outputs.push({
            extractor: 'react-routes',
            available: true,
            surfaces: extractReactRouteSurfaces(routes),
          });
        }
      }
      if (isLaravel) {
        outputs.push(...(await laravelExtractors(projectRoot)));
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

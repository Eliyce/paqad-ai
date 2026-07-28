// Surface extraction — the S1 (`extraction`) stage of the site-map workflow. Pure detectors
// that turn already-gathered, normalized inputs into RAW surfaces: the deterministic material
// the modeling stage (S2, LLM) later names, slugs, and attributes. Mirrors codebase-health's
// `detectors.ts` — no I/O, no shell, no network — so every branch is exercised with fixtures;
// the impure gathering (reading the commander program, walking the tree) lives in the gatherer.
//
// FR-2: extraction is deterministic and injectable (zero model tokens). FR-3: an unavailable
// extractor is recorded as a blocked check and the run proceeds — a blocked check is a gap,
// never a silent pass. See docs/specs/site-map-capability.plan.md §II.3 (S1) and §II.4.

import { createHash } from 'node:crypto';

import { slugify } from '@/pentest/shared.js';
import type { SiteMapBlockedCheck } from '@/core/types/site-map-run.js';
import type {
  AppKind,
  Confidence,
  Evidence,
  SurfaceEntry,
  SurfaceKind,
} from '@/core/types/site-map.js';

/** Bumped when the in-memory extraction shape changes; independent of the map schema version. */
export const SITE_MAP_EXTRACTION_SCHEMA_VERSION = 1;

const NODE_CLI_SOURCE = 'node-cli';
const GENERIC_SOURCE = 'generic';
const REACT_ROUTES_SOURCE = 'react-routes';
const LARAVEL_ROUTES_SOURCE = 'laravel-routes';
const LARAVEL_ARTISAN_SOURCE = 'laravel-artisan-routes';
const LARAVEL_CONSOLE_SOURCE = 'laravel-console';
const LARAVEL_SCHEDULE_SOURCE = 'laravel-schedule';
const LARAVEL_JOBS_SOURCE = 'laravel-jobs';
const LARAVEL_MAIL_SOURCE = 'laravel-mail';

/** Synthetic evidence `file` labels for artisan-sourced surfaces (no on-disk file:line). */
const ARTISAN_ROUTE_EVIDENCE = 'php artisan route:list';
const ARTISAN_LIST_EVIDENCE = 'php artisan list';
const ARTISAN_SCHEDULE_EVIDENCE = 'php artisan schedule:list';

/** One commander command as read from the CLI program (normalized by the gatherer). */
export interface CliCommandRecord {
  /** Space-joined command path, e.g. `sitemap` or `plan compile`. */
  name: string;
  description?: string;
  /** Where the command is registered. */
  file: string;
  line?: number;
  /** commander `.hidden()` commands are internal plumbing, not user-facing surfaces. */
  hidden?: boolean;
}

/** A raw surface entry from the generic fallback (any stack the gatherer can enumerate). */
export interface GenericSurfaceRecord {
  kind: SurfaceKind;
  /** Raw identifier: a route path, url, screen name, etc. */
  identifier: string;
  label?: string;
  file: string;
  line?: number;
  entry?: SurfaceEntry;
}

/** A raw surface produced by extraction — deterministic material for the modeling stage. */
export interface ExtractedSurface {
  /** Stable, slug-shaped id derived from the raw identifier (the modeling stage refines it). */
  raw_id: string;
  kind: SurfaceKind;
  label: string;
  evidence: Evidence[];
  entry?: SurfaceEntry;
  /** Extraction is always static/deterministic. */
  derivation: 'static';
  confidence: Confidence;
  /** Which extractor produced it, e.g. `node-cli` or `generic`. */
  source: string;
  /** Raw guard hints (e.g. route middleware tokens) for the guard-inference stage to resolve. */
  guards?: string[];
  /** Module attribution (e.g. the owning `nwidart` module) when the source reveals it. */
  module?: string;
}

/** One extractor's contribution to a run: its surfaces, or a blocked check when unavailable. */
export interface ExtractorOutput {
  extractor: string;
  available: boolean;
  surfaces: ExtractedSurface[];
  /** Populated when `available` is false: why it could not run and how to enable it. */
  blocked?: SiteMapBlockedCheck | null;
}

/** The merged, fingerprinted result of the extraction stage (the `extraction.json` shape). */
export interface ExtractionResult {
  schema_version: number;
  app_kind: AppKind;
  surfaces: ExtractedSurface[];
  blocked_checks: SiteMapBlockedCheck[];
  /** Content-addressed over the raw surface set — the drift signal for the freshness gate. */
  fingerprint: string;
  /** How many extractors actually ran (available === true). */
  extractors_ran: number;
  /** True when NO extractor ran: any downstream surfaces are an agent-led, low-confidence fallback. */
  low_confidence_fallback: boolean;
}

/** `file:line` evidence, omitting `line` when the gatherer could not pin one. */
function toEvidence(file: string, line?: number): Evidence {
  return line === undefined ? { file } : { file, line };
}

/** A slug-shaped raw id: `<source>-<slug>`, or just `<source>` when the identifier has no word chars. */
function toRawId(source: string, identifier: string): string {
  const slug = slugify(identifier);
  return slug.length > 0 ? `${source}-${slug}` : source;
}

/**
 * Node-CLI extractor: each non-hidden commander command becomes a `cli-command` surface whose
 * entry is the binary invocation. Hidden commands are internal plumbing, never a surface.
 */
export function extractNodeCliSurfaces(records: CliCommandRecord[]): ExtractedSurface[] {
  const surfaces: ExtractedSurface[] = [];
  for (const record of records) {
    if (record.hidden) continue;
    const description = record.description?.trim();
    surfaces.push({
      raw_id: toRawId(NODE_CLI_SOURCE, record.name),
      kind: 'cli-command',
      label: description && description.length > 0 ? description : record.name,
      evidence: [toEvidence(record.file, record.line)],
      entry: { kind: 'bin', value: record.name },
      derivation: 'static',
      confidence: 'high',
      source: NODE_CLI_SOURCE,
    });
  }
  return surfaces;
}

/**
 * Generic fallback extractor: for stacks without a dedicated extractor, the gatherer hands over
 * already-enumerated raw entries. We trust their kind but flag the whole set `medium` confidence
 * — a convention-based read, not a first-class extractor.
 */
export function extractGenericSurfaces(records: GenericSurfaceRecord[]): ExtractedSurface[] {
  return records.map((record) => {
    const label = record.label?.trim();
    return {
      raw_id: toRawId(GENERIC_SOURCE, record.identifier),
      kind: record.kind,
      label: label && label.length > 0 ? label : record.identifier,
      evidence: [toEvidence(record.file, record.line)],
      ...(record.entry ? { entry: record.entry } : {}),
      derivation: 'static' as const,
      confidence: 'medium' as const,
      source: GENERIC_SOURCE,
    };
  });
}

/** One declared React route as read from a route tree (React Router objects, Next app/pages). */
export interface ReactRouteRecord {
  /** Route path, e.g. `/checkout` or `/users/:id`. */
  path: string;
  /** The component or page the route renders, used as the label when present. */
  component?: string;
  file: string;
  line?: number;
}

/**
 * React-route extractor: each declared route becomes a `page` surface whose entry is the URL.
 * High confidence — the route is read from an explicit declaration, not a naming convention.
 * The label is the component name when known, else the path.
 */
export function extractReactRouteSurfaces(records: ReactRouteRecord[]): ExtractedSurface[] {
  return records.map((record) => {
    const component = record.component?.trim();
    return {
      raw_id: toRawId(REACT_ROUTES_SOURCE, record.path),
      kind: 'page' as const,
      label: component && component.length > 0 ? component : record.path,
      evidence: [toEvidence(record.file, record.line)],
      entry: { kind: 'url', value: record.path },
      derivation: 'static' as const,
      confidence: 'high' as const,
      source: REACT_ROUTES_SOURCE,
    };
  });
}

/** One declared Laravel route, e.g. `Route::get('/users', ...)` or an `routes/api.php` entry. */
export interface LaravelRouteRecord {
  /** HTTP method, upper-cased, e.g. `GET`. */
  method: string;
  /** Route uri without a leading slash, e.g. `users` or `api/orders`. */
  uri: string;
  /** Controller@action or closure label, used as the label when present. */
  action?: string;
  file: string;
  line?: number;
}

/**
 * Laravel-route extractor: an `api/`-prefixed uri becomes an `api` surface, everything else a
 * `page`. High confidence — read from an explicit `Route::` declaration. The entry is the uri as
 * a rooted URL; the label is the controller action when known, else the method + uri.
 */
export function extractLaravelRouteSurfaces(records: LaravelRouteRecord[]): ExtractedSurface[] {
  return records.map((record) => {
    const uri = record.uri.replace(/^\/+/, '');
    const isApi = uri === 'api' || uri.startsWith('api/');
    const action = record.action?.trim();
    return {
      raw_id: toRawId(LARAVEL_ROUTES_SOURCE, `${record.method} ${uri}`),
      kind: isApi ? ('api' as const) : ('page' as const),
      label: action && action.length > 0 ? action : `${record.method} /${uri}`,
      evidence: [toEvidence(record.file, record.line)],
      entry: { kind: 'url', value: `/${uri}` },
      derivation: 'static' as const,
      confidence: 'high' as const,
      source: LARAVEL_ROUTES_SOURCE,
    };
  });
}

// --- Framework-native Laravel extraction (issue #445) --------------------------------------
//
// Prefer the framework's own introspection over grepping fixed directories: `php artisan
// route:list --json` resolves modules, middleware, and controllers through the real router, so
// modular routes (nwidart) and guards come for free. The impure shell-out + JSON read live in
// the coverage-excluded gatherer; the normalization (parse*) and mapping (extract*) below are
// pure and fully covered. Artisan-sourced surfaces have no on-disk `file:line`, so their
// evidence is the artisan command that produced them (INV-2: still a grounded pointer).

/** One route as read from `php artisan route:list --json` (normalized by the parser). */
export interface LaravelArtisanRouteRecord {
  /** HTTP method(s), e.g. `GET|HEAD`. */
  method: string;
  /** Route uri, e.g. `api/users/{user}` or `/`. */
  uri: string;
  name?: string;
  /** `App\Http\Controllers\UserController@index`, `Closure`, etc. */
  action?: string;
  /** Middleware tokens applied to the route (guard hints). */
  middleware?: string[];
  domain?: string;
}

/** One command as read from `php artisan list --format=json` (normalized by the parser). */
export interface LaravelConsoleCommandRecord {
  name: string;
  description?: string;
  hidden?: boolean;
}

/** One scheduled task as read from `php artisan schedule:list` (normalized by the parser). */
export interface LaravelScheduledTaskRecord {
  /** Cron expression, e.g. `0 2 * * *` or `@daily`. */
  expression: string;
  /** The command the schedule runs (or its description). */
  command: string;
}

/** One queued-job / mailable class as read by the modular-aware static class scan. */
export interface LaravelClassSurfaceRecord {
  /** Class name (short or FQCN), used as the label. */
  className: string;
  file: string;
  line?: number;
  /** Owning module (from a `Modules/<Name>/` path or namespace) when known. */
  module?: string;
}

// ESC (0x1b) built at runtime so no control char appears in source (no-control-regex).
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
/** A leading cron expression: a `@shorthand`, or 5-6 space-separated cron fields. */
const CRON_LINE_RE = /^(@\w+|(?:[\d*,/-]+\s+){4,5}[\d*,/-]+)\s+(.+)$/;
/** The owning module in a `…\Modules\<Name>\…` controller namespace. */
const MODULE_NS_RE = /(?:^|\\)Modules\\([^\\]+)\\/;

/** Strip a `?ref`/query and leading slashes from a uri, leaving the bare path. */
function normalizeUri(uri: string): string {
  return uri.replace(/^\/+/, '');
}

/** The owning module from a controller action namespace, if it is a `Modules\<Name>` class. */
function moduleFromAction(action: string | undefined): string | undefined {
  if (action === undefined) return undefined;
  const match = MODULE_NS_RE.exec(action);
  return match ? match[1] : undefined;
}

/** Coerce artisan's `middleware` (array, string, or absent) into a clean token list. */
function normalizeMiddleware(raw: unknown): string[] {
  const tokens = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : [];
  return tokens
    .map((token) => (typeof token === 'string' ? token.trim() : ''))
    .filter((token) => token.length > 0);
}

/**
 * Parse `php artisan route:list --json` stdout into normalized route records. Malformed output
 * (not JSON, not an array) yields an empty list rather than throwing, so the gatherer degrades
 * to the static scan instead of crashing the run.
 */
export function parseArtisanRouteList(stdout: string): LaravelArtisanRouteRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: LaravelArtisanRouteRecord[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const method = typeof row.method === 'string' ? row.method : '';
    const uri = typeof row.uri === 'string' ? row.uri : '';
    if (method.length === 0 || uri.length === 0) continue;
    const middleware = normalizeMiddleware(row.middleware);
    records.push({
      method,
      uri,
      ...(typeof row.name === 'string' && row.name.length > 0 ? { name: row.name } : {}),
      ...(typeof row.action === 'string' && row.action.length > 0 ? { action: row.action } : {}),
      ...(middleware.length > 0 ? { middleware } : {}),
      ...(typeof row.domain === 'string' && row.domain.length > 0 ? { domain: row.domain } : {}),
    });
  }
  return records;
}

/**
 * Parse `php artisan list --format=json` stdout into normalized command records. Symfony wraps
 * the commands in a `{ commands: [...] }` envelope; a bare array is also accepted. Malformed
 * output yields an empty list.
 */
export function parseArtisanCommandList(stdout: string): LaravelConsoleCommandRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { commands?: unknown }).commands)
      ? (parsed as { commands: unknown[] }).commands
      : [];
  const records: LaravelConsoleCommandRecord[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name.length === 0) continue;
    records.push({
      name,
      ...(typeof row.description === 'string' && row.description.length > 0
        ? { description: row.description }
        : {}),
      ...(row.hidden === true ? { hidden: true } : {}),
    });
  }
  return records;
}

/**
 * Parse `php artisan schedule:list` stdout (a table, no `--json`) into normalized task records.
 * Each task line begins with its cron expression; the remainder up to the trailing dotted
 * "Next Due" filler is the command. Lines without a leading cron expression are skipped.
 */
export function parseArtisanScheduleList(stdout: string): LaravelScheduledTaskRecord[] {
  const records: LaravelScheduledTaskRecord[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(ANSI_RE, '').trim();
    const match = CRON_LINE_RE.exec(line);
    if (!match) continue;
    const expression = match[1]!.trim();
    // The line is already outer-trimmed and the command is the `.+` tail, so it is never empty.
    const command = match[2]!
      .replace(/\s+\.{2,}.*$/, '')
      .replace(/\s+Next Due:.*$/, '')
      .trim();
    records.push({ expression, command });
  }
  return records;
}

/**
 * Artisan-route extractor: each registered route becomes a surface — `api`-prefixed uris are
 * `api`, the rest `page` — carrying its middleware as guard hints and its owning module (from a
 * `Modules\<Name>` controller namespace). Evidence is the artisan command, since the resolved
 * router gives us no `file:line`. High confidence: read from the real router, not a convention.
 */
export function extractLaravelArtisanRoutes(
  records: LaravelArtisanRouteRecord[],
): ExtractedSurface[] {
  return records.map((record) => {
    const uri = normalizeUri(record.uri);
    const isApi = uri === 'api' || uri.startsWith('api/');
    const primaryMethod = record.method.split(/[|,]/)[0]!.trim() || record.method;
    const action = record.action?.trim();
    const module = moduleFromAction(record.action);
    return {
      raw_id: toRawId(LARAVEL_ARTISAN_SOURCE, `${primaryMethod} ${uri}`),
      kind: isApi ? ('api' as const) : ('page' as const),
      label:
        action && action.length > 0 && action !== 'Closure' ? action : `${primaryMethod} /${uri}`,
      evidence: [{ file: ARTISAN_ROUTE_EVIDENCE, note: `${primaryMethod} /${uri}` }],
      entry: { kind: 'url', value: `/${uri}` },
      derivation: 'static' as const,
      confidence: 'high' as const,
      source: LARAVEL_ARTISAN_SOURCE,
      ...(record.middleware && record.middleware.length > 0 ? { guards: record.middleware } : {}),
      ...(module ? { module } : {}),
    };
  });
}

/**
 * Console-command extractor: each non-hidden artisan command becomes a `cli-command` surface.
 * Hidden commands are Symfony/framework plumbing, never a user-facing surface.
 */
export function extractLaravelConsoleCommands(
  records: LaravelConsoleCommandRecord[],
): ExtractedSurface[] {
  const surfaces: ExtractedSurface[] = [];
  for (const record of records) {
    if (record.hidden) continue;
    const description = record.description?.trim();
    surfaces.push({
      raw_id: toRawId(LARAVEL_CONSOLE_SOURCE, record.name),
      kind: 'cli-command',
      label: description && description.length > 0 ? description : record.name,
      evidence: [{ file: ARTISAN_LIST_EVIDENCE, note: record.name }],
      entry: { kind: 'artisan', value: record.name },
      derivation: 'static',
      confidence: 'high',
      source: LARAVEL_CONSOLE_SOURCE,
    });
  }
  return surfaces;
}

/**
 * Scheduled-task extractor: each scheduled task becomes a `job` surface whose entry is the cron
 * expression. Evidence is the artisan command; the label is the scheduled command.
 */
export function extractLaravelScheduledJobs(
  records: LaravelScheduledTaskRecord[],
): ExtractedSurface[] {
  return records.map((record) => ({
    raw_id: toRawId(LARAVEL_SCHEDULE_SOURCE, `${record.expression} ${record.command}`),
    kind: 'job' as const,
    label: record.command,
    evidence: [{ file: ARTISAN_SCHEDULE_EVIDENCE, note: record.expression }],
    entry: { kind: 'schedule', value: record.expression },
    derivation: 'static' as const,
    confidence: 'high' as const,
    source: LARAVEL_SCHEDULE_SOURCE,
  }));
}

/** Map a scanned class list to surfaces of a fixed kind (jobs → `job`, mailables → `email`). */
function extractLaravelClassSurfaces(
  records: LaravelClassSurfaceRecord[],
  kind: SurfaceKind,
  source: string,
): ExtractedSurface[] {
  return records.map((record) => ({
    raw_id: toRawId(source, record.className),
    kind,
    label: record.className,
    evidence: [toEvidence(record.file, record.line)],
    derivation: 'static' as const,
    confidence: 'high' as const,
    source,
    ...(record.module ? { module: record.module } : {}),
  }));
}

/**
 * Queued-job extractor: each `ShouldQueue` class (from the modular-aware scan) becomes a `job`
 * surface with resolving `file:line` evidence. Jobs are not registered like routes, so this is
 * the one Laravel family with no artisan introspection — a static scan is the primary source.
 */
export function extractLaravelJobs(records: LaravelClassSurfaceRecord[]): ExtractedSurface[] {
  return extractLaravelClassSurfaces(records, 'job', LARAVEL_JOBS_SOURCE);
}

/**
 * Mailable extractor: each mailable / notification class (from the modular-aware scan) becomes
 * an `email` surface with resolving `file:line` evidence.
 */
export function extractLaravelMailables(records: LaravelClassSurfaceRecord[]): ExtractedSurface[] {
  return extractLaravelClassSurfaces(records, 'email', LARAVEL_MAIL_SOURCE);
}

/** Merge two evidence lists, dropping exact `file:line:note` duplicates (stable order). */
function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const merged: Evidence[] = [];
  for (const evidence of [...a, ...b]) {
    const key = `${evidence.file}:${evidence.line ?? ''}:${evidence.note ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(evidence);
  }
  return merged;
}

/** Collapse surfaces sharing a `raw_id` (first wins, evidence unioned) without mutating inputs. */
function dedupeSurfaces(surfaces: ExtractedSurface[]): ExtractedSurface[] {
  const byId = new Map<string, ExtractedSurface>();
  for (const surface of surfaces) {
    const existing = byId.get(surface.raw_id);
    if (!existing) {
      byId.set(surface.raw_id, { ...surface, evidence: [...surface.evidence] });
      continue;
    }
    existing.evidence = mergeEvidence(existing.evidence, surface.evidence);
  }
  return [...byId.values()];
}

/** Order surfaces deterministically by `raw_id` so runs and fingerprints are reproducible. */
export function sortExtractedSurfaces(surfaces: ExtractedSurface[]): ExtractedSurface[] {
  return [...surfaces].sort((a, b) => a.raw_id.localeCompare(b.raw_id));
}

/**
 * Content-addressed fingerprint over the raw surface set (id + kind + evidence), order-
 * independent so a re-run over the same code yields the same digest. This is the drift signal
 * the freshness gate compares against the map's recorded baseline (zero unexplained drift).
 */
export function extractionFingerprint(surfaces: ExtractedSurface[]): string {
  const payload = JSON.stringify(
    [...surfaces]
      .map((surface) => ({
        raw_id: surface.raw_id,
        kind: surface.kind,
        evidence: surface.evidence,
      }))
      .sort((a, b) => a.raw_id.localeCompare(b.raw_id)),
  );
  // SHA-256 (not for security — a stable content-addressed drift key; only already-safe map
  // metadata reaches here).
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** Build a blocked-extractor output: it ran nothing, and records why plus how to enable it (FR-3). */
export function blockedExtractor(
  extractor: string,
  reason: string,
  installHint: string,
): ExtractorOutput {
  return {
    extractor,
    available: false,
    surfaces: [],
    blocked: { check: `${extractor} surface extraction`, reason, install_hint: installHint },
  };
}

/**
 * Merge every extractor's output into the fingerprinted `extraction.json` shape: available
 * extractors contribute surfaces (deduped and sorted), unavailable ones contribute blocked
 * checks, and the run proceeds either way. `low_confidence_fallback` is true when nothing ran.
 */
export function assembleExtraction(outputs: ExtractorOutput[], appKind: AppKind): ExtractionResult {
  const surfaces = sortExtractedSurfaces(
    dedupeSurfaces(
      outputs.filter((output) => output.available).flatMap((output) => output.surfaces),
    ),
  );
  const blockedChecks = outputs.flatMap((output) =>
    !output.available && output.blocked ? [output.blocked] : [],
  );
  const extractorsRan = outputs.filter((output) => output.available).length;
  return {
    schema_version: SITE_MAP_EXTRACTION_SCHEMA_VERSION,
    app_kind: appKind,
    surfaces,
    blocked_checks: blockedChecks,
    fingerprint: extractionFingerprint(surfaces),
    extractors_ran: extractorsRan,
    low_confidence_fallback: extractorsRan === 0,
  };
}

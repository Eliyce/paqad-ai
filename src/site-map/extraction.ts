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

import type { SourcePointer } from './laravel-sources.js';

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

const UNRESOLVED_LIST_CAP = 10;

export interface CliCommandRecord {
  name: string;
  description?: string;
  file: string;
  line?: number;
  hidden?: boolean;
}

export interface GenericSurfaceRecord {
  kind: SurfaceKind;
  identifier: string;
  label?: string;
  file: string;
  line?: number;
  entry?: SurfaceEntry;
}

export interface ExtractedSurface {
  raw_id: string;
  kind: SurfaceKind;
  label: string;
  evidence: Evidence[];
  entry?: SurfaceEntry;
  derivation: 'static';
  confidence: Confidence;
  source: string;
  guards?: string[];
  module?: string;
}

export interface ExtractorOutput {
  extractor: string;
  available: boolean;
  surfaces: ExtractedSurface[];
  blocked?: SiteMapBlockedCheck | null;
}

export interface ExtractionResult {
  schema_version: number;
  app_kind: AppKind;
  surfaces: ExtractedSurface[];
  blocked_checks: SiteMapBlockedCheck[];
  fingerprint: string;
  extractors_ran: number;
  low_confidence_fallback: boolean;
}

function toEvidence(file: string, line?: number): Evidence {
  return line === undefined ? { file } : { file, line };
}

function toRawId(source: string, identifier: string): string {
  const slug = slugify(identifier);
  return slug.length > 0 ? `${source}-${slug}` : source;
}

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

export interface ReactRouteRecord {
  path: string;
  component?: string;
  file: string;
  line?: number;
}

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

export interface LaravelRouteRecord {
  method: string;
  uri: string;
  action?: string;
  file: string;
  line?: number;
}

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

export interface LaravelArtisanRouteRecord {
  method: string;
  uri: string;
  name?: string;
  action?: string;
  middleware?: string[];
  domain?: string;
}

export interface LaravelConsoleCommandRecord {
  name: string;
  description?: string;
  hidden?: boolean;
}

export interface LaravelScheduledTaskRecord {
  expression: string;
  command: string;
}

export interface LaravelClassSurfaceRecord {
  className: string;
  file: string;
  line?: number;
  module?: string;
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const CRON_LINE_RE = /^(@\w+|(?:[\d*,/-]+\s+){4,5}[\d*,/-]+)\s+(.+)$/;
const MODULE_NS_RE = /(?:^|\\)Modules\\([^\\]+)\\/;

function normalizeUri(uri: string): string {
  return uri.replace(/^\/+/, '');
}

function moduleFromAction(action: string | undefined): string | undefined {
  if (action === undefined) return undefined;
  const match = MODULE_NS_RE.exec(action);
  return match ? match[1] : undefined;
}

function normalizeMiddleware(raw: unknown): string[] {
  const tokens = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : [];
  return tokens
    .map((token) => (typeof token === 'string' ? token.trim() : ''))
    .filter((token) => token.length > 0);
}

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

export function parseArtisanScheduleList(stdout: string): LaravelScheduledTaskRecord[] {
  const records: LaravelScheduledTaskRecord[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(ANSI_RE, '').trim();
    const match = CRON_LINE_RE.exec(line);
    if (!match) continue;
    const expression = match[1]!.trim();
    const command = match[2]!
      .replace(/\s+\.{2,}.*$/, '')
      .replace(/\s+Next Due:.*$/, '')
      .trim();
    records.push({ expression, command });
  }
  return records;
}

export interface TracedExtraction {
  surfaces: ExtractedSurface[];
  unresolved: string[];
}

function pointersToEvidence(pointers: SourcePointer[], note: string): Evidence[] {
  return pointers.map((pointer) => ({ ...pointer, note }));
}

export function extractLaravelArtisanRoutes(
  records: LaravelArtisanRouteRecord[],
  resolve: (record: LaravelArtisanRouteRecord) => SourcePointer[],
): TracedExtraction {
  const surfaces: ExtractedSurface[] = [];
  const unresolved: string[] = [];
  for (const record of records) {
    const uri = normalizeUri(record.uri);
    const isApi = uri === 'api' || uri.startsWith('api/');
    const primaryMethod = record.method.split(/[|,]/)[0]!.trim() || record.method;
    const route = `${primaryMethod} /${uri}`;
    const pointers = resolve(record);
    if (pointers.length === 0) {
      unresolved.push(route);
      continue;
    }
    const action = record.action?.trim();
    const module = moduleFromAction(record.action);
    surfaces.push({
      raw_id: toRawId(LARAVEL_ARTISAN_SOURCE, `${primaryMethod} ${uri}`),
      kind: isApi ? ('api' as const) : ('page' as const),
      label: action && action.length > 0 && action !== 'Closure' ? action : route,
      evidence: pointersToEvidence(pointers, `php artisan route:list (${route})`),
      entry: { kind: 'url', value: `/${uri}` },
      derivation: 'static' as const,
      confidence: 'high' as const,
      source: LARAVEL_ARTISAN_SOURCE,
      ...(record.middleware && record.middleware.length > 0 ? { guards: record.middleware } : {}),
      ...(module ? { module } : {}),
    });
  }
  return { surfaces, unresolved };
}

export function extractLaravelConsoleCommands(
  records: LaravelConsoleCommandRecord[],
  locate: (name: string) => SourcePointer | undefined,
): ExtractedSurface[] {
  const surfaces: ExtractedSurface[] = [];
  for (const record of records) {
    if (record.hidden) continue;
    const pointer = locate(record.name);
    if (!pointer) continue;
    const description = record.description?.trim();
    surfaces.push({
      raw_id: toRawId(LARAVEL_CONSOLE_SOURCE, record.name),
      kind: 'cli-command',
      label: description && description.length > 0 ? description : record.name,
      evidence: pointersToEvidence([pointer], `php artisan list (${record.name})`),
      entry: { kind: 'artisan', value: record.name },
      derivation: 'static',
      confidence: 'high',
      source: LARAVEL_CONSOLE_SOURCE,
    });
  }
  return surfaces;
}

export function extractLaravelScheduledJobs(
  records: LaravelScheduledTaskRecord[],
  locate: (command: string) => SourcePointer | undefined,
): TracedExtraction {
  const surfaces: ExtractedSurface[] = [];
  const unresolved: string[] = [];
  for (const record of records) {
    const pointer = locate(record.command);
    if (!pointer) {
      unresolved.push(`${record.expression} ${record.command}`);
      continue;
    }
    surfaces.push({
      raw_id: toRawId(LARAVEL_SCHEDULE_SOURCE, `${record.expression} ${record.command}`),
      kind: 'job' as const,
      label: record.command,
      evidence: pointersToEvidence([pointer], `php artisan schedule:list (${record.expression})`),
      entry: { kind: 'schedule', value: record.expression },
      derivation: 'static' as const,
      confidence: 'high' as const,
      source: LARAVEL_SCHEDULE_SOURCE,
    });
  }
  return { surfaces, unresolved };
}

export function unresolvedBlockedCheck(
  extractor: string,
  noun: string,
  items: string[],
  cause = '',
): SiteMapBlockedCheck | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, UNRESOLVED_LIST_CAP).join(', ');
  const more =
    items.length > UNRESOLVED_LIST_CAP ? `, and ${items.length - UNRESOLVED_LIST_CAP} more` : '';
  return {
    check: `${extractor} source tracing`,
    reason: `${items.length} ${noun} could not be traced to a source file${cause}: ${shown}${more}`,
    install_hint:
      'Point each one at a class in your project (a closure has no file to cite), or add it to docs/site-map/app-map.yaml by hand with the file that defines it.',
  };
}

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

export function extractLaravelJobs(records: LaravelClassSurfaceRecord[]): ExtractedSurface[] {
  return extractLaravelClassSurfaces(records, 'job', LARAVEL_JOBS_SOURCE);
}

export function extractLaravelMailables(records: LaravelClassSurfaceRecord[]): ExtractedSurface[] {
  return extractLaravelClassSurfaces(records, 'email', LARAVEL_MAIL_SOURCE);
}

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

export function sortExtractedSurfaces(surfaces: ExtractedSurface[]): ExtractedSurface[] {
  return [...surfaces].sort((a, b) => a.raw_id.localeCompare(b.raw_id));
}

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
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

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

export function assembleExtraction(outputs: ExtractorOutput[], appKind: AppKind): ExtractionResult {
  const surfaces = sortExtractedSurfaces(
    dedupeSurfaces(
      outputs.filter((output) => output.available).flatMap((output) => output.surfaces),
    ),
  );
  const blockedChecks = outputs.flatMap((output) => (output.blocked ? [output.blocked] : []));
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

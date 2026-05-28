// Module-map reconciler. Issue #80, Phase 2.
//
// Scans the source tree (rooted at `source_roots` from the active stack pack)
// and compares it against the declared modules + features in
// module-map.yml + the docs/modules/<slug>/ tree. Emits MM-* findings to
// .paqad/module-map/drift.json. Pure detection — never mutates module-map.yml
// itself; user-approved deltas flow back through src/module-decisions/apply.ts.
//
// Hard-fails with `blocked: source_roots_unknown` when the stack pack does
// not declare module_health.source_roots. No silent fallback (spec AC #17).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import fg from 'fast-glob';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { appendModuleMapEvent } from '@/module-decisions/events.js';
import { listDecisions } from '@/module-decisions/store.js';
import { toPosixPath } from '@/core/path-utils.js';

export type MMFindingCode =
  | 'MM-ADD'
  | 'MM-FEAT-ADD'
  | 'MM-REMOVE'
  | 'MM-RENAME'
  | 'MM-FEAT-STALE'
  | 'MM-DOC-ORPHAN'
  | 'MM-DOC-MISSING'
  | 'MM-MISMATCH';

export interface MMFinding {
  code: MMFindingCode;
  module_slug: string | null;
  feature_slug: string | null;
  paths: string[];
  detail: string;
}

export interface ModuleMapDriftReport {
  generated_at: string;
  source_roots: string[];
  findings: MMFinding[];
  blocked: 'source_roots_unknown' | null;
  counts: Record<MMFindingCode, number>;
}

export interface ReconcilerOptions {
  projectRoot: string;
  // Required. Pulled from active stack pack's module_health.source_roots.
  // Pass null to trigger the hard-fail path.
  sourceRoots: string[] | null;
  // File extensions to consider (e.g. ['.ts', '.tsx']). Defaults to '*' (any).
  fileExtensions?: string[];
  // Glob exclusions in addition to node_modules / dist / build / .paqad.
  extraExcludes?: string[];
  // When true (default), also write the report to .paqad/module-map/drift.json.
  writeReport?: boolean;
}

interface RawFeature {
  slug: string;
  name: string;
  sources: string[];
}

interface RawModule {
  slug: string;
  name: string;
  sources: string[];
  features: RawFeature[];
}

interface RawMap {
  modules: RawModule[];
}

const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.paqad/**',
  '**/coverage/**',
];

function emptyCounts(): Record<MMFindingCode, number> {
  return {
    'MM-ADD': 0,
    'MM-FEAT-ADD': 0,
    'MM-REMOVE': 0,
    'MM-RENAME': 0,
    'MM-FEAT-STALE': 0,
    'MM-DOC-ORPHAN': 0,
    'MM-DOC-MISSING': 0,
    'MM-MISMATCH': 0,
  };
}

// Read module-map.yml directly. The on-disk format uses `sources:` (not
// `source_paths:` as the registry-generator type declares); this reader
// accepts either to be forgiving of both shapes.
export function readRawModuleMap(projectRoot: string): RawMap | null {
  const path = join(projectRoot, PATHS.MODULE_MAP);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = YAML.parse(raw) as Record<string, unknown> | null;
  if (parsed === null || typeof parsed !== 'object') return null;
  const modulesRaw = Array.isArray(parsed['modules']) ? parsed['modules'] : [];
  const modules: RawModule[] = modulesRaw.map((m) => {
    const mod = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    const sources = pickSources(mod);
    const featuresRaw = Array.isArray(mod['features']) ? mod['features'] : [];
    const features: RawFeature[] = featuresRaw.map((f) => {
      const feat = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
      return {
        slug: String(feat['slug'] ?? ''),
        name: String(feat['name'] ?? ''),
        sources: pickSources(feat),
      };
    });
    return {
      slug: String(mod['slug'] ?? ''),
      name: String(mod['name'] ?? ''),
      sources,
      features,
    };
  });
  return { modules };
}

function pickSources(obj: Record<string, unknown>): string[] {
  const candidates = obj['sources'] ?? obj['source_paths'];
  if (!Array.isArray(candidates)) return [];
  return candidates.map(String);
}

function normaliseGlob(spec: string): string {
  let g = spec.trim();
  // Bare directory / file path → recurse under it so reconciler matches
  // contained files. `src/foo` → `src/foo/**`.
  if (!g.includes('*') && !g.includes('?') && !g.endsWith('.ts') && !g.endsWith('.tsx')) {
    if (!g.endsWith('/')) g += '/';
    g += '**';
  }
  return g;
}

async function listFilesUnder(
  projectRoot: string,
  roots: string[],
  fileExtensions: string[] | undefined,
  excludes: string[],
): Promise<string[]> {
  const patterns =
    fileExtensions === undefined || fileExtensions.length === 0
      ? roots.map((r) => `${r.replace(/\/+$/, '')}/**/*`)
      : roots.flatMap((r) =>
          fileExtensions.map(
            (ext) => `${r.replace(/\/+$/, '')}/**/*${ext.startsWith('.') ? ext : `.${ext}`}`,
          ),
        );
  const results = await fg(patterns, {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
    ignore: [...DEFAULT_EXCLUDES, ...excludes],
    followSymbolicLinks: false,
  });
  return results.map(toPosixPath).sort();
}

// In-memory glob matcher. fast-glob ships picomatch under the hood for disk
// matching, but not as a public match() helper, so we use a small regex-based
// translator tailored to the patterns module-map.yml uses (segment globs and
// `**` recursion). Good enough for `src/foo/**` / `src/foo/*.ts` shapes.
function globToRegex(glob: string): RegExp {
  const g = normaliseGlob(glob);
  let re = '^';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      // ** → match any path segments (including none)
      re += '.*';
      i += 2;
      if (g[i] === '/') i++; // consume trailing slash after **
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+()|^$[]{}\\'.includes(c ?? '')) {
      re += `\\${c}`;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAnyGlob(file: string, globs: string[]): boolean {
  for (const g of globs) {
    if (g.length === 0) continue;
    if (globToRegex(g).test(file)) return true;
  }
  return false;
}

function listDocModuleDirs(projectRoot: string): string[] {
  const docsDir = join(projectRoot, 'docs', 'modules');
  if (!existsSync(docsDir)) return [];
  return readdirSync(docsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function writeDriftReport(projectRoot: string, report: ModuleMapDriftReport): void {
  const path = join(projectRoot, PATHS.MODULE_MAP_DRIFT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

export async function reconcileModuleMap(
  opts: ReconcilerOptions,
): Promise<ModuleMapDriftReport> {
  const now = new Date().toISOString();
  const counts = emptyCounts();
  const findings: MMFinding[] = [];

  if (opts.sourceRoots === null || opts.sourceRoots.length === 0) {
    const report: ModuleMapDriftReport = {
      generated_at: now,
      source_roots: [],
      findings: [],
      blocked: 'source_roots_unknown',
      counts,
    };
    if (opts.writeReport !== false) {
      writeDriftReport(opts.projectRoot, report);
      appendModuleMapEvent(opts.projectRoot, {
        ts: now,
        type: 'module.reconciled',
        payload: { blocked: 'source_roots_unknown' },
      });
    }
    return report;
  }

  const map = readRawModuleMap(opts.projectRoot);
  const modules = map?.modules ?? [];

  // 1. Walk the source tree.
  const allFiles = await listFilesUnder(
    opts.projectRoot,
    opts.sourceRoots,
    opts.fileExtensions,
    opts.extraExcludes ?? [],
  );

  // Pre-build per-module file lists.
  const filesByModule = new Map<string, string[]>();
  const matchedFiles = new Set<string>();
  for (const mod of modules) {
    const matched = allFiles.filter((f) => matchesAnyGlob(f, mod.sources));
    filesByModule.set(mod.slug, matched);
    for (const f of matched) matchedFiles.add(f);
  }

  // 2. MM-REMOVE — declared module whose sources match no files.
  for (const mod of modules) {
    const matched = filesByModule.get(mod.slug) ?? [];
    if (matched.length === 0) {
      findings.push({
        code: 'MM-REMOVE',
        module_slug: mod.slug,
        feature_slug: null,
        paths: mod.sources,
        detail: `Declared module "${mod.slug}" has no matching source files under source_roots.`,
      });
      counts['MM-REMOVE']++;
    }
  }

  // 3. MM-FEAT-STALE — declared feature whose sources match no files.
  for (const mod of modules) {
    for (const feat of mod.features) {
      if (feat.sources.length === 0) continue;
      const featMatches = allFiles.filter((f) => matchesAnyGlob(f, feat.sources));
      if (featMatches.length === 0) {
        findings.push({
          code: 'MM-FEAT-STALE',
          module_slug: mod.slug,
          feature_slug: feat.slug,
          paths: feat.sources,
          detail: `Feature "${mod.slug}/${feat.slug}" has no matching source files.`,
        });
        counts['MM-FEAT-STALE']++;
      }
    }
  }

  // 4. MM-ADD — source file matched by no declared module. Group by directory
  //    to keep finding count tractable on large repos.
  const undeclared = allFiles.filter((f) => !matchedFiles.has(f));
  const undeclaredByDir = new Map<string, string[]>();
  for (const f of undeclared) {
    const dir = f.split('/').slice(0, -1).join('/');
    const bucket = undeclaredByDir.get(dir) ?? [];
    bucket.push(f);
    undeclaredByDir.set(dir, bucket);
  }
  // Cross-check against prospective MD-XXXX declarations: when a directory's
  // path tokens already appear in an accepted/proposed decision, emit
  // MM-MISMATCH (paths diverge from declaration) instead of MM-ADD.
  const prospectiveSlugs = new Set(
    listDecisions(opts.projectRoot)
      .filter((d) => d.state === 'proposed' || d.state === 'accepted')
      .map((d) => d.proposed_slug),
  );
  const knownSlugs = new Set(modules.map((m) => m.slug));
  for (const [dir, files] of undeclaredByDir) {
    const dirSlugGuess = dir.split('/').slice(-1)[0] ?? '';
    if (prospectiveSlugs.has(dirSlugGuess) && !knownSlugs.has(dirSlugGuess)) {
      findings.push({
        code: 'MM-MISMATCH',
        module_slug: dirSlugGuess,
        feature_slug: null,
        paths: files,
        detail: `Prospective module "${dirSlugGuess}" is declared but its accepted decision has not yet been applied to module-map.yml.`,
      });
      counts['MM-MISMATCH']++;
    } else {
      findings.push({
        code: 'MM-ADD',
        module_slug: null,
        feature_slug: null,
        paths: files,
        detail: `Undeclared source files under "${dir}" — no module's sources: glob matches.`,
      });
      counts['MM-ADD']++;
    }
  }

  // 5. MM-FEAT-ADD — file matches a module but not any of that module's
  //    features (only flagged when the module has feature globs declared).
  for (const mod of modules) {
    if (mod.features.every((f) => f.sources.length === 0)) continue;
    const modFiles = filesByModule.get(mod.slug) ?? [];
    const featGlobs = mod.features.flatMap((f) => f.sources);
    const orphan = modFiles.filter((f) => !matchesAnyGlob(f, featGlobs));
    if (orphan.length === 0) continue;
    findings.push({
      code: 'MM-FEAT-ADD',
      module_slug: mod.slug,
      feature_slug: null,
      paths: orphan,
      detail: `${orphan.length} file(s) in module "${mod.slug}" match no declared feature glob.`,
    });
    counts['MM-FEAT-ADD']++;
  }

  // 6. MM-DOC-MISSING / MM-DOC-ORPHAN.
  const docDirs = new Set(listDocModuleDirs(opts.projectRoot));
  for (const mod of modules) {
    if (!docDirs.has(mod.slug)) {
      findings.push({
        code: 'MM-DOC-MISSING',
        module_slug: mod.slug,
        feature_slug: null,
        paths: [`docs/modules/${mod.slug}/`],
        detail: `Module "${mod.slug}" is declared but has no docs/modules/${mod.slug}/ directory.`,
      });
      counts['MM-DOC-MISSING']++;
    }
  }
  for (const dir of docDirs) {
    if (!knownSlugs.has(dir)) {
      findings.push({
        code: 'MM-DOC-ORPHAN',
        module_slug: dir,
        feature_slug: null,
        paths: [`docs/modules/${dir}/`],
        detail: `docs/modules/${dir}/ exists but no module with slug "${dir}" is declared.`,
      });
      counts['MM-DOC-ORPHAN']++;
    }
  }

  // 7. MM-RENAME — only when a stack pack's public_api_extractor is wired. We
  //    don't currently have one, so MM-RENAME falls back to MM-REMOVE + MM-ADD
  //    pairs (spec AC #18). Leaving this branch empty intentionally.

  const report: ModuleMapDriftReport = {
    generated_at: now,
    source_roots: opts.sourceRoots,
    findings,
    blocked: null,
    counts,
  };

  if (opts.writeReport !== false) {
    writeDriftReport(opts.projectRoot, report);
    // AC #36: append a reconciliation audit record once the drift report
    // has landed. Skipped on writeReport:false (in-memory test paths) so
    // unit tests don't accidentally inflate the log.
    appendModuleMapEvent(opts.projectRoot, {
      ts: now,
      type: 'module.reconciled',
      payload: {
        finding_counts: counts,
        total_findings: findings.length,
        source_roots: opts.sourceRoots,
      },
    });
  }

  return report;
}

// Convenience: load the latest drift report from disk (Phase 4 dashboard uses
// this; the reconciler itself writes it, so callers that want the freshest
// view should invoke reconcileModuleMap directly).
export function readDriftReport(projectRoot: string): ModuleMapDriftReport | null {
  const path = join(projectRoot, PATHS.MODULE_MAP_DRIFT);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ModuleMapDriftReport;
  } catch {
    return null;
  }
}

// Helper for callers (status / refresh / documentation_sync) to ask
// "is there drift?" without inspecting counts manually.
export function driftReportHasFindings(report: ModuleMapDriftReport | null): boolean {
  if (report === null) return false;
  if (report.blocked !== null) return true;
  return report.findings.length > 0;
}

// Used by callers to surface the "we couldn't run" reason explicitly.
export function driftReportBlockedReason(report: ModuleMapDriftReport | null): string | null {
  return report?.blocked ?? null;
}

// Exported test hooks.
export { matchesAnyGlob as _matchesAnyGlob, normaliseGlob as _normaliseGlob };

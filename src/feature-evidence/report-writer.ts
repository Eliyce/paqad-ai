// Per-feature evidence report writer (issue #371).
//
// The thin, side-effecting layer around the pure `renderFeatureReportHtml` renderer:
// it reads the feature's bundle (via the existing `exportFeatureBundle`), folds its
// stage evidence (via `foldFeature`), renders the HTML, and writes
// `report.html` next to the JSON it came from — atomically (temp + rename) so a crash
// never leaves a half-written page. Everything here is best-effort by contract: a caller
// (the verification backstop, the delivery-link hook, the CLI) wraps it so a render or
// write failure can never disrupt the change.
//
// Issue #581 (FR-5) — the page carries the one envelope header in a
// `<script type="application/json" id="paqad-header">` tag in its `<head>`. Its `content_hash`
// is the SHA-256 of the page as rendered, before the tag is added.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { resolveFrameworkConfig } from '@/core/framework-config.js';

import { documentSessionId } from './bundle-document.js';
import { listFeatureDirs } from './delivery.js';
import { buildTextHeader, renderHeaderScript } from './envelope.js';
import { exportFeatureBundle } from './export.js';
import { featureChangeKey, featureReportPath, parseFeatureDirName } from './paths.js';
import { renderFeatureReportHtml } from './report.js';
import { foldFeature, resolveFeatureRef } from './stage-ledger.js';

/** Doc type of a bundle's `report.html` header (`paqad.<file-stem>`, issue #581). */
export const REPORT_DOC_TYPE = 'paqad.report';
/** The first versioned shape of `report.html`: the page with its header tag (issue #581). */
export const REPORT_SCHEMA_VERSION = 1;

/** Put the envelope header tag at the end of the page's `<head>` (issue #581). */
function withHeaderTag(html: string, tag: string): string {
  return html.replace('</head>', `${tag}\n</head>`);
}

export interface WriteFeatureReportOptions {
  /** Deterministic generation timestamp; defaults to now. */
  generatedAt?: string;
  /** Session id used only as the fold's identity label (reads are dir-scoped). */
  sessionId?: string;
  /** paqad version stamped into the header. */
  paqadVersion?: string | null;
  /** Write elsewhere than the bundle dir's `report.html`. */
  outPath?: string;
}

export interface WriteFeatureReportResult {
  /** Absolute path the report was written to. */
  path: string;
  html: string;
}

/**
 * Read the feature-report enablement flag across the four config surfaces. Default true
 * (local, free, zero-LLM); the off-switch exists for minimalists. NOT gated on
 * enterprise — the report renders whatever exists.
 */
export function featureReportEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveFrameworkConfig(projectRoot, env).features.feature_report;
}

/**
 * Render and write a feature's `report.html`. Returns the absolute path written and the
 * HTML. Callers wrap this best-effort — it throws only on an unresolvable render/write
 * error, never swallowing internally so tests can assert failures.
 */
export function writeFeatureReport(
  projectRoot: string,
  dirName: string,
  options: WriteFeatureReportOptions = {},
): WriteFeatureReportResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sessionId = options.sessionId ?? 'report';
  const bundle = exportFeatureBundle(projectRoot, dirName, generatedAt);
  const fold = foldFeature(projectRoot, sessionId, dirName);
  const page = renderFeatureReportHtml(bundle, fold, {
    generatedAt,
    paqadVersion: options.paqadVersion ?? null,
  });
  const header = buildTextHeader({
    docType: REPORT_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: documentSessionId(projectRoot, dirName, options.sessionId),
    schemaVersion: REPORT_SCHEMA_VERSION,
    body: page,
    now: () => new Date(generatedAt),
  });
  const html = withHeaderTag(page, renderHeaderScript(header));
  const abs = options.outPath
    ? isAbsolute(options.outPath)
      ? options.outPath
      : join(projectRoot, options.outPath)
    : join(projectRoot, featureReportPath(dirName));
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, html, 'utf8');
  renameSync(tmp, abs);
  return { path: abs, html };
}

/**
 * Resolve a feature ref for the report CLI: an explicit ref (ULID / issue / slug / dir
 * name) against this session first, then a whole-tree scan of every bundle dir; with no
 * ref, the session's active feature, else the most recent bundle by trailing ULID. Null
 * when nothing resolves.
 */
export function resolveReportFeatureRef(
  projectRoot: string,
  sessionId: string,
  ref: string | undefined,
  activeDirName: string | null,
): string | null {
  if (ref) {
    const sessionMatch = resolveFeatureRef(projectRoot, sessionId, ref);
    if (sessionMatch) return sessionMatch;
    return scanAllFeatureDirs(projectRoot, ref);
  }
  if (activeDirName) return activeDirName;
  return mostRecentFeatureDir(projectRoot);
}

/** Match a ref against every bundle dir on disk (dir name / ULID / issue / slug substring). */
function scanAllFeatureDirs(projectRoot: string, ref: string): string | null {
  const needle = ref.trim().replace(/^#/, '');
  const dirs = listFeatureDirs(projectRoot);
  for (const dirName of dirs) {
    if (dirName === ref || dirName === needle) return dirName;
    const parts = parseFeatureDirName(dirName);
    if (parts && (parts.ulid === needle || parts.issue === needle || parts.slug === needle)) {
      return dirName;
    }
  }
  for (const dirName of dirs) {
    const parts = parseFeatureDirName(dirName);
    if (parts && parts.slug.includes(needle)) return dirName;
  }
  return null;
}

/** The most recent bundle dir by trailing ULID (time-sortable), or null when none. */
function mostRecentFeatureDir(projectRoot: string): string | null {
  const dirs = listFeatureDirs(projectRoot).sort((a, b) =>
    (parseFeatureDirName(b)?.ulid ?? b).localeCompare(parseFeatureDirName(a)?.ulid ?? a),
  );
  return dirs[0] ?? null;
}

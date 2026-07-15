// Per-feature evidence report writer (issue #371).
//
// The thin, side-effecting layer around the pure `renderFeatureReportHtml` renderer:
// it reads the feature's bundle (via the existing `exportFeatureBundle`), folds its
// stage evidence (via `foldFeature`), best-effort loads the agent-authored `review.md`
// from the review stage's recorded artifact path, renders the HTML, and writes
// `report.html` next to the JSON it came from — atomically (temp + rename) so a crash
// never leaves a half-written page. Everything here is best-effort by contract: a caller
// (the verification backstop, the delivery-link hook, the CLI) wraps it so a render or
// write failure can never disrupt the change.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { resolveFrameworkConfig } from '@/core/framework-config.js';

import { listFeatureDirs } from './delivery.js';
import { exportFeatureBundle, type FeatureBundleExport } from './export.js';
import { featureReportPath, parseFeatureDirName } from './paths.js';
import { renderFeatureReportHtml } from './report.js';
import { foldFeature, resolveFeatureRef } from './stage-ledger.js';

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

type LooseRow = Record<string, unknown>;

/**
 * Best-effort read of the review markdown from the review stage's recorded artifact path.
 * The review file is agent-authored and is NOT a rigid bundle file, so it is discovered
 * via the `review` `stage_end` row's `artifact_paths` (never a fixed filename). Only an
 * in-tree `.md` is read; anything else (absent, out-of-tree, unreadable) returns null.
 */
export function readReviewMarkdown(
  projectRoot: string,
  bundle: FeatureBundleExport,
): string | null {
  const rows = Array.isArray(bundle.files.stageEvidence)
    ? (bundle.files.stageEvidence as LooseRow[])
    : [];
  let artifactPath: string | null = null;
  for (const row of rows) {
    if (row.kind === 'stage_end' && row.stage === 'review' && Array.isArray(row.artifact_paths)) {
      const first = (row.artifact_paths as unknown[]).find(
        (p): p is string => typeof p === 'string' && p.toLowerCase().endsWith('.md'),
      );
      if (first) artifactPath = first;
    }
  }
  if (!artifactPath) return null;
  const abs = isAbsolute(artifactPath) ? artifactPath : join(projectRoot, artifactPath);
  // Reject an out-of-tree path (never read outside the project root).
  const rel = relative(projectRoot, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
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
  const reviewMarkdown = readReviewMarkdown(projectRoot, bundle);
  const html = renderFeatureReportHtml(bundle, fold, {
    generatedAt,
    paqadVersion: options.paqadVersion ?? null,
    reviewMarkdown,
  });
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

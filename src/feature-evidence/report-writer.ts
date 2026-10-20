import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';

import { documentSessionId } from './bundle-document.js';
import { listFeatureDirs } from './delivery.js';
import { buildTextHeader, renderHeaderScript } from './envelope.js';
import { readIndexedDecisionViews } from './decisions-index.js';
import { exportFeatureBundle } from './export.js';
import { featureChangeKey, featureReportPath, parseFeatureDirName } from './paths.js';
import { renderFeatureReportHtml } from './report.js';
import { foldFeature, resolveFeatureRef } from './stage-ledger.js';
import type { VerdictKind } from '@/verification/verdict-kind.js';

export const REPORT_DOC_TYPE = 'paqad.report';
export const REPORT_SCHEMA_VERSION = 1;

function withHeaderTag(html: string, tag: string): string {
  return html.replace('</head>', `${tag}\n</head>`);
}

export interface WriteFeatureReportOptions {
  generatedAt?: string;
  sessionId?: string;
  paqadVersion?: string | null;
  outPath?: string;
  verdict?: VerdictKind;
}

export interface WriteFeatureReportResult {
  path: string;
  html: string;
}

export function featureReportEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveFrameworkConfig(projectRoot, env).features.feature_report;
}

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
    decisions: readIndexedDecisionViews(projectRoot, dirName),
    ...(options.verdict ? { verdict: options.verdict } : {}),
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
  renameWithRetrySync(tmp, abs);
  return { path: abs, html };
}

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

function mostRecentFeatureDir(projectRoot: string): string | null {
  const dirs = listFeatureDirs(projectRoot).sort((a, b) =>
    (parseFeatureDirName(b)?.ulid ?? b).localeCompare(parseFeatureDirName(a)?.ulid ?? a),
  );
  return dirs[0] ?? null;
}

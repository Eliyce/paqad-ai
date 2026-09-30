// Discovery run report generator (issue #597, DW-06).
//
// Renders a read-only `report.html` from a run's canonical records so a fresh person can see the
// value, decisions, evidence, blockers, and next step WITHOUT the original chat (DW-AC27). The
// report is a PROJECTION: it carries the envelope header (doc type `paqad.discovery.report`, the
// source run revision) and can never set machine completion state — the JSON records remain the one
// authority. Its generation is itself recorded (the header names the source revision).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildTextHeader, renderHeaderScript } from '@/feature-evidence/envelope.js';

import { foldDiscoveryRun } from './fold.js';
import { discoveryReportPath, discoveryRunChangeKey, discoveryRunFilePath } from './paths.js';
import { readDiscoveryStageRows } from './recorder.js';
import { readDiscoveryRun } from './run-store.js';
import { DISCOVERY_DOC_TYPES, DISCOVERY_SCHEMA_VERSION } from './types.js';

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readJson(projectRoot: string, relPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, relPath), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function list(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) {
    return '<p class="empty">none recorded</p>';
  }
  return `<ul>${values.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`;
}

function section(title: string, inner: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

/**
 * Render the run's `report.html` body + envelope header. Missing records render as an empty
 * section rather than failing — a partial run still produces a readable view.
 */
export function renderDiscoveryReport(projectRoot: string, dirName: string): string {
  const run = readDiscoveryRun(projectRoot, dirName);
  const brief = readJson(projectRoot, discoveryRunFilePath(dirName, 'brief'));
  const synthesis = readJson(projectRoot, discoveryRunFilePath(dirName, 'synthesis'));
  const readiness = readJson(projectRoot, discoveryRunFilePath(dirName, 'readiness'));
  const handoff = readJson(projectRoot, discoveryRunFilePath(dirName, 'handoff'));
  const folded = foldDiscoveryRun(readDiscoveryStageRows(projectRoot, dirName));

  const title = run ? escapeHtml(run.title) : escapeHtml(dirName);
  const stageRows = folded.stages
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.stage)}</td><td>${s.complete ? '🟢 done' : s.started ? '🟡 in progress' : '⚪ not started'}</td></tr>`,
    )
    .join('');

  const body = [
    `<h1>Discovery — ${title}</h1>`,
    `<p class="meta">status <strong>${escapeHtml(run?.status ?? 'unknown')}</strong> · outcome <strong>${escapeHtml(run?.outcome ?? 'not decided')}</strong> · revision ${escapeHtml(run?.revision ?? '?')} · verdict <strong>${escapeHtml(folded.verdict)}</strong></p>`,
    `<p class="note">This is a read-only projection of the canonical records. It cannot set completion state.</p>`,
    section(
      'Stages',
      `<table><thead><tr><th>stage</th><th>state</th></tr></thead><tbody>${stageRows}</tbody></table>`,
    ),
    section(
      'Intended outcome',
      brief ? `<p>${escapeHtml(brief.intent)}</p>` : '<p class="empty">no brief yet</p>',
    ),
    section('Success', list(brief?.success)),
    section(
      'Recommendation',
      synthesis
        ? `<p>${escapeHtml(synthesis.recommendation)}</p>`
        : '<p class="empty">no synthesis yet</p>',
    ),
    section('Readiness blockers', list(readiness?.blockers)),
    section(
      'Hand-off next action',
      handoff
        ? `<p>${escapeHtml(handoff.next_action)}</p><p class="meta">authorization: ${escapeHtml(handoff.authorization)}</p>`
        : '<p class="empty">not handed off yet</p>',
    ),
  ].join('\n');

  const header = buildTextHeader({
    docType: DISCOVERY_DOC_TYPES.report,
    change: discoveryRunChangeKey(dirName),
    sessionId: run?.session_id ?? 'unknown',
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    body,
  });

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>Discovery — ${title}</title>`,
    renderHeaderScript(header),
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;color:#1a1a1a}h1{font-size:1.5rem}h2{font-size:1.05rem;margin-top:1.5rem}.meta{color:#555}.note{color:#888;font-style:italic}.empty{color:#999}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}</style>',
    '</head><body>',
    body,
    '</body></html>',
    '',
  ].join('\n');
}

/** Render and atomically write a run's `report.html`. Returns the project-relative path. */
export function writeDiscoveryReport(projectRoot: string, dirName: string): string {
  const html = renderDiscoveryReport(projectRoot, dirName);
  const rel = discoveryReportPath(dirName);
  const abs = join(projectRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  writeFileSync(tmp, html, 'utf8');
  renameSync(tmp, abs);
  return rel;
}

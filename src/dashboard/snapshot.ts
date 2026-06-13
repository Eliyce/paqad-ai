import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { buildReceiptFeed } from './trust.js';

/**
 * Issue #161 — access-free shareable snapshots. A snapshot is a single
 * self-contained HTML document (inline styles, no scripts, no live calls) of
 * one trust receipt or one module-health card, so it renders correctly even
 * with the dashboard server stopped. Read-only; nothing here mutates.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function page(title: string, generatedAt: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0f172a;background:#fafafa;margin:0;padding:32px">
<main style="max-width:640px;margin:0 auto">
${body}
<p style="font-size:12px;color:#94a3b8;margin:24px 0 0">Snapshot generated ${escapeHtml(generatedAt)}. Static copy, no live data.</p>
</main>
</body>
</html>
`;
}

/** Render one receipt (matched by full or short hash) as a static page, or null. */
export function buildReceiptSnapshot(projectRoot: string, hash: string): string | null {
  const feed = buildReceiptFeed(projectRoot);
  const receipt =
    feed.receipts.find((r) => r.receipt_hash === hash) ??
    feed.receipts.find((r) => r.receipt_hash.startsWith(hash));
  if (!receipt) return null;

  const generatedAt = new Date().toISOString();
  const seal = receipt.sealed
    ? '<span style="color:#16a34a">sealed</span>'
    : '<span style="color:#dc2626">chain broken</span>';
  const author = escapeHtml(
    receipt.authorship?.model_id ?? receipt.authorship?.agent ?? 'unknown agent',
  );
  const human = receipt.authorship?.accepting_human?.name;
  const checks = receipt.checks
    .map(
      (c) =>
        `<li style="margin:3px 0"><code>${escapeHtml(c.code)}</code> <span style="color:#64748b">(${escapeHtml(c.verdict)}, ${escapeHtml(c.strength_class)})</span></li>`,
    )
    .join('');
  const subjects = receipt.subjects
    .map((s) => `<li style="margin:3px 0">${escapeHtml(s.name)}</li>`)
    .join('');

  const body = `<h1 style="font-size:20px;font-weight:600;margin:0 0 4px">Receipt ${escapeHtml(receipt.receipt_hash.slice(0, 16))}</h1>
<p style="font-size:13px;color:#64748b;margin:0 0 16px">${seal} · ${escapeHtml(receipt.signing_mode)}${receipt.verification_result ? ` · verification ${escapeHtml(receipt.verification_result.toLowerCase())}` : ''}</p>
<section style="background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:16px">
<p style="font-size:14px;margin:0 0 8px">Written by ${author}${human ? `, accepted by ${escapeHtml(human)}` : ''} (${escapeHtml(receipt.authorship?.provenance ?? 'unknown')}).</p>
<h2 style="font-size:15px;font-weight:600;margin:12px 0 4px">Checks</h2>
<ul style="list-style:none;padding:0;margin:0;font-size:13px">${checks || '<li style="color:#64748b">No checks recorded.</li>'}</ul>
<h2 style="font-size:15px;font-weight:600;margin:12px 0 4px">Covers ${receipt.subjects.length} ${receipt.subjects.length === 1 ? 'file' : 'files'}</h2>
<ul style="list-style:none;padding:0;margin:0;font-size:13px">${subjects || '<li style="color:#64748b">No files recorded.</li>'}</ul>
</section>`;
  return page(`Receipt ${receipt.receipt_hash.slice(0, 16)}`, generatedAt, body);
}

interface ModuleHealthFile {
  module: string;
  tier: string;
  metrics?: Record<string, number | null>;
  updated_at?: string;
}

/** Render one module-health card (id may carry a `module:` prefix) as a static page, or null. */
export function buildModuleSnapshot(projectRoot: string, id: string): string | null {
  const slug = id.replace(/^module:/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) return null;
  const path = join(projectRoot, PATHS.PLANNING_MODULE_HEALTH_DIR, `${slug}.json`);
  if (!existsSync(path)) return null;

  let health: ModuleHealthFile;
  try {
    health = JSON.parse(readFileSync(path, 'utf8')) as ModuleHealthFile;
  } catch {
    return null;
  }

  const generatedAt = new Date().toISOString();
  const tierColor =
    health.tier === 'green' ? '#16a34a' : health.tier === 'red' ? '#dc2626' : '#d97706';
  const metricRows = Object.entries(health.metrics ?? {})
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(key)}</td><td style="padding:4px 0;text-align:right">${value === null || value === undefined ? '—' : escapeHtml(String(value))}</td></tr>`,
    )
    .join('');

  const body = `<h1 style="font-size:20px;font-weight:600;margin:0 0 4px">Module ${escapeHtml(slug)}</h1>
<p style="font-size:13px;margin:0 0 16px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${tierColor};margin-right:6px"></span>health tier: ${escapeHtml(health.tier)}${health.updated_at ? ` · updated ${escapeHtml(health.updated_at)}` : ''}</p>
<section style="background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:16px">
<h2 style="font-size:15px;font-weight:600;margin:0 0 8px">Metrics</h2>
<table style="font-size:13px;border-collapse:collapse;width:100%">${metricRows || '<tr><td style="color:#64748b">No metrics recorded.</td></tr>'}</table>
</section>`;
  return page(`Module ${slug}`, generatedAt, body);
}

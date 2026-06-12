import { buildEvidenceFeed, buildReceiptFeed, readAiBomDocument } from './trust.js';

/**
 * Issue #146 — `GET /api/export/evidence-packet` (spec sections 5.3 and 6.1).
 *
 * A polished, standalone bundle of the trust artifacts: the evidence
 * timeline, the receipt chain with seal status, and the AI-BOM summary.
 * Rendered as self-contained HTML (inline styles, no scripts, no external
 * requests) so it can be attached to a release or shown to a stakeholder
 * as-is, plus a Markdown form for PRs and chat, plus the raw JSON.
 * Evidence is view and export only; nothing here mutates.
 */

export interface EvidencePacket {
  generatedAt: string;
  projectName: string | null;
  json: {
    evidence: ReturnType<typeof buildEvidenceFeed>;
    receipts: ReturnType<typeof buildReceiptFeed>;
    aiBom: ReturnType<typeof readAiBomDocument>;
  };
  markdown: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function verdictDot(verdict: string): string {
  const color = verdict === 'pass' ? '#16a34a' : verdict === 'fail' ? '#dc2626' : '#d97706';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${color};margin-right:6px"></span>`;
}

export function buildEvidencePacket(
  projectRoot: string,
  options: { projectName?: string | null } = {},
): EvidencePacket {
  const evidence = buildEvidenceFeed(projectRoot, { limit: 500 });
  const receipts = buildReceiptFeed(projectRoot);
  const aiBom = readAiBomDocument(projectRoot);
  const generatedAt = new Date().toISOString();
  const projectName = options.projectName ?? null;
  const title = projectName ? `Verification evidence, ${projectName}` : 'Verification evidence';

  const modelCount = Array.isArray((aiBom as { components?: unknown[] } | null)?.components)
    ? (aiBom as { components: unknown[] }).components.length
    : 0;

  const markdownLines: string[] = [
    `# ${title}`,
    '',
    `Generated ${generatedAt}. ${evidence.total} ledger entries, ${receipts.receipts.length} sealed receipts.`,
    '',
    '## Receipts',
    '',
  ];
  if (receipts.receipts.length === 0) {
    markdownLines.push('No receipts yet. The first one appears after the first verified change.');
  } else {
    for (const receipt of receipts.receipts) {
      const author = receipt.authorship?.agent ?? 'unknown agent';
      const model = receipt.authorship?.model_id ?? null;
      markdownLines.push(
        `- ${receipt.sealed ? 'Sealed' : 'Broken link'} \`${receipt.receipt_hash.slice(0, 16)}\` ` +
          `by ${author}${model ? ` (${model})` : ''}: ` +
          `${receipt.checks.length} checks, result ${receipt.verification_result ?? 'n/a'}.`,
      );
    }
  }
  markdownLines.push('', '## Evidence timeline', '');
  if (evidence.rows.length === 0) {
    markdownLines.push('No gate runs recorded yet.');
  } else {
    for (const row of evidence.rows.slice(0, 100)) {
      markdownLines.push(`- ${row.verdict.toUpperCase()} ${row.code} (${row.engine})`);
    }
  }
  markdownLines.push('', '## AI bill of materials', '');
  markdownLines.push(
    aiBom === null
      ? 'No AI-BOM projected yet.'
      : `${modelCount} model${modelCount === 1 ? '' : 's'} recorded (CycloneDX).`,
  );
  const markdown = `${markdownLines.join('\n')}\n`;

  const receiptRows = receipts.receipts
    .map((receipt) => {
      const author = escapeHtml(receipt.authorship?.agent ?? 'unknown agent');
      const voucher = receipt.authorship?.model_id
        ? ` (${escapeHtml(receipt.authorship.model_id)})`
        : '';
      const seal = receipt.sealed
        ? '<span style="color:#16a34a">sealed</span>'
        : '<span style="color:#dc2626">broken link</span>';
      return `<li style="margin:6px 0">${seal} <code>${escapeHtml(receipt.receipt_hash.slice(0, 16))}</code> by ${author}${voucher}. ${receipt.checks.length} checks, result ${escapeHtml(receipt.verification_result ?? 'n/a')}.</li>`;
    })
    .join('');
  const evidenceRows = evidence.rows
    .slice(0, 200)
    .map(
      (row) =>
        `<li style="margin:4px 0">${verdictDot(row.verdict)}${escapeHtml(row.code)} <span style="color:#64748b">(${escapeHtml(row.engine)}, ${escapeHtml(row.verdict)})</span></li>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0f172a;background:#fafafa;margin:0;padding:32px">
<main style="max-width:720px;margin:0 auto">
<h1 style="font-size:22px;font-weight:600;margin:0 0 4px">${escapeHtml(title)}</h1>
<p style="font-size:13px;color:#64748b;margin:0 0 24px">Generated ${escapeHtml(generatedAt)}. ${evidence.total} ledger entries, ${receipts.receipts.length} receipts. Proof you can show anyone: what was checked, who wrote it, who vouched.</p>
<section style="background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:16px">
<h2 style="font-size:17px;font-weight:600;margin:0 0 8px">Receipts</h2>
<ul style="list-style:none;padding:0;margin:0;font-size:15px">${receiptRows || '<li style="color:#64748b">No receipts yet. The first one appears after the first verified change.</li>'}</ul>
</section>
<section style="background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:16px">
<h2 style="font-size:17px;font-weight:600;margin:0 0 8px">Evidence timeline</h2>
<ul style="list-style:none;padding:0;margin:0;font-size:13px">${evidenceRows || '<li style="color:#64748b">No gate runs recorded yet.</li>'}</ul>
</section>
<section style="background:#fff;border-radius:10px;padding:16px 20px">
<h2 style="font-size:17px;font-weight:600;margin:0 0 8px">AI bill of materials</h2>
<p style="font-size:15px;margin:0">${aiBom === null ? 'No AI-BOM projected yet.' : `${modelCount} model${modelCount === 1 ? '' : 's'} recorded (CycloneDX).`}</p>
</section>
</main>
</body>
</html>
`;

  return {
    generatedAt,
    projectName,
    json: { evidence, receipts, aiBom },
    markdown,
    html,
  };
}

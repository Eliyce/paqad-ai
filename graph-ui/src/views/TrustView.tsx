import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { SavedViewsBar } from '../components/SavedViewsBar';
import { WinLine } from '../components/WinLine';
import {
  fetchAiBom,
  fetchDashboard,
  fetchEvidence,
  fetchEvidencePacketMarkdown,
  fetchPrComment,
  fetchReceipts,
} from '../lib/api';
import { PAGE_WHY } from '../lib/copy';
import type {
  AiBomResponse,
  EvidenceFeed,
  EvidenceRow,
  ReceiptCard,
  ReceiptFeed,
} from '../lib/dashboard-types';

const VERDICT_COLOR: Record<EvidenceRow['verdict'], string> = {
  pass: 'var(--color-mod-green)',
  fail: 'var(--color-mod-red)',
  inconclusive: 'var(--color-mod-amber)',
  blocked: 'var(--color-mod-amber)',
};

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

const SIEM_FORMATS = [
  { value: 'ocsf', label: 'OCSF (recommended)' },
  { value: 'ecs', label: 'ECS' },
  { value: 'cef', label: 'CEF' },
  { value: 'jsonl', label: 'JSONL' },
] as const;

type SiemFormatValue = (typeof SIEM_FORMATS)[number]['value'];

function EvidenceLine({ row }: { row: EvidenceRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="border-b py-2 text-sm last:border-b-0"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <button
        type="button"
        className="flex w-full items-baseline gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span
          className="inline-block h-2 w-2 shrink-0 self-center rounded-full"
          style={{ background: VERDICT_COLOR[row.verdict] }}
          title={row.verdict}
        />
        <span>
          Gate <code>{row.code}</code> {row.verdict === 'pass' ? 'passed' : row.verdict}
          {row.detail ? ': ' + row.detail : ''}
        </span>
        <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>
          {new Date(row.ts).toLocaleString()}
        </span>
      </button>
      {open && (
        <pre
          className="mt-2 overflow-x-auto rounded p-2 text-xs"
          style={{ background: 'var(--color-canvas)', color: 'var(--color-muted)' }}
        >
          {JSON.stringify(row, null, 2)}
        </pre>
      )}
    </li>
  );
}

/**
 * Issue #122 — clause chips on a receipt. One chip per cited clause (deduped
 * across the gates that satisfy it), with the pack's disclaimer on hover. The
 * wording is deliberately "evidence toward", never "compliant".
 */
function ComplianceChips({ citations }: { citations: ReceiptCard['compliance'] }) {
  const byClause = new Map<string, ReceiptCard['compliance'][number]>();
  for (const citation of citations) {
    byClause.set(citation.framework_id + '|' + citation.clause_id, citation);
  }
  const clauses = [...byClause.values()];
  const disclaimer = citations[0]?.disclaimer;
  return (
    <div className="mt-2">
      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Evidence toward
      </div>
      <ul className="mt-1 flex flex-wrap gap-2 text-xs">
        {clauses.map((c) => (
          <li
            key={c.framework_id + c.clause_id}
            className="rounded border px-2 py-0.5"
            style={{ borderColor: 'var(--color-border)' }}
            title={disclaimer}
          >
            {c.framework_title} {c.clause_id}
            <span style={{ color: 'var(--color-muted)' }}> ({c.evidence_strength})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptCardView({
  receipt,
  onCopy,
  animateSeal,
}: {
  receipt: ReceiptCard;
  onCopy: () => void;
  /** Plays the one allowed spring: the 300ms seal scale on a new receipt. */
  animateSeal?: boolean;
}) {
  const human = receipt.authorship?.accepting_human?.name;
  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">Receipt {shortHash(receipt.receipt_hash)}</div>
        <span
          className={'text-xs' + (animateSeal === true ? ' receipt-seal-animate' : '')}
          style={{
            color: receipt.sealed ? 'var(--color-mod-green)' : 'var(--color-mod-red)',
          }}
          title={
            receipt.sealed
              ? 'The hash chain recomputes cleanly. This record has not been altered.'
              : 'The hash chain breaks at or before this receipt.'
          }
        >
          {receipt.sealed ? '✓ sealed' : '✗ chain broken'}
        </span>
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        {receipt.verification_result === 'PASSED' ? 'Verification passed' : null}
        {receipt.verification_result === 'FAILED' ? 'Verification failed' : null}
        {receipt.time_verified ? ' · ' + new Date(receipt.time_verified).toLocaleString() : null}
        {' · ' + receipt.signing_mode}
      </div>
      {receipt.authorship && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          Written by {receipt.authorship.model_id ?? receipt.authorship.agent ?? 'unknown agent'}
          {human ? ', accepted by ' + human : ''} ({receipt.authorship.provenance})
        </div>
      )}
      {receipt.reproducibility && (
        <div
          className="mt-2 text-xs"
          style={{ color: 'var(--color-muted)' }}
          title="Proves the context the agent saw is replayable from these exact inputs. It does not claim the model would regenerate the same output."
        >
          Replayable from frozen context:{' '}
          <code>{shortHash(receipt.reproducibility.context_hash)}</code> (
          {receipt.reproducibility.determinism})
        </div>
      )}
      {receipt.compliance.length > 0 && <ComplianceChips citations={receipt.compliance} />}
      {receipt.checks.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {receipt.checks.map((check, i) => (
            <li
              key={check.code + i}
              className="flex items-center gap-1 rounded border px-2 py-0.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: VERDICT_COLOR[check.verdict] }}
              />
              {check.code}
              <span style={{ color: 'var(--color-muted)' }}>({check.strength_class})</span>
            </li>
          ))}
        </ul>
      )}
      {receipt.subjects.length > 0 && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          Covers {receipt.subjects.length} {receipt.subjects.length === 1 ? 'file' : 'files'}:{' '}
          {receipt.subjects
            .slice(0, 3)
            .map((s) => s.name)
            .join(', ')}
          {receipt.subjects.length > 3 ? '…' : ''}
        </div>
      )}
      <div className="mt-3 flex items-baseline gap-3">
        <button
          type="button"
          className="text-xs"
          style={{ color: 'var(--color-accent)' }}
          onClick={onCopy}
        >
          Copy as PR comment
        </button>
        <button
          type="button"
          className="text-xs"
          style={{ color: 'var(--color-accent)' }}
          onClick={() =>
            window.open(
              '/api/snapshot/receipt/' + encodeURIComponent(receipt.receipt_hash),
              '_blank',
              'noopener',
            )
          }
        >
          Share snapshot
        </button>
      </div>
    </div>
  );
}

/**
 * The Trust area (issue #146): evidence timeline, receipt cards, AI-BOM.
 * View and export only. Evidence is deliberately not editable, because
 * editable evidence is worthless.
 */
export function TrustView() {
  const [evidence, setEvidence] = useState<EvidenceFeed | null>(null);
  const [receipts, setReceipts] = useState<ReceiptFeed | null>(null);
  const [aiBom, setAiBom] = useState<AiBomResponse | null>(null);
  const [verdictFilter, setVerdictFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [packetCopied, setPacketCopied] = useState(false);
  const [sseLive, setSseLive] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  /** The newest receipt's hash when it arrived live, so only it seals. */
  const [sealHash, setSealHash] = useState<string | null>(null);
  const receiptCountRef = useRef<number | null>(null);
  // SIEM export utility (issue #160).
  const [siemFormat, setSiemFormat] = useState<SiemFormatValue>('ocsf');
  const [siemSince, setSiemSince] = useState('');
  const [siemRedact, setSiemRedact] = useState(false);
  const [siemBusy, setSiemBusy] = useState(false);
  const [siemResult, setSiemResult] = useState<string | null>(null);

  const loadAll = useCallback((): void => {
    Promise.all([
      fetchEvidence(verdictFilter ? { verdict: verdictFilter } : {}),
      fetchReceipts(),
      fetchAiBom(),
    ])
      .then(([nextEvidence, nextReceipts, nextBom]) => {
        setEvidence(nextEvidence);
        setReceipts(nextReceipts);
        setAiBom(nextBom);
        setError(null);
        const count = nextReceipts.receipts.length;
        // A new receipt arrived while the view was open: play the one
        // allowed spring on the newest receipt's sealed indicator.
        if (receiptCountRef.current !== null && count > receiptCountRef.current) {
          setSealHash(nextReceipts.receipts[0]?.receipt_hash ?? null);
        }
        receiptCountRef.current = count;
        // Receipts have been seen: completes the checklist's receipt step.
        if (count > 0) {
          try {
            localStorage.setItem('paqad-receipt-viewed', '1');
          } catch {
            // private mode; the checklist step stays pending, nothing breaks
          }
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [verdictFilter]);

  useEffect(() => {
    loadAll();
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine
      });
  }, [loadAll]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('dashboard-updated', () => loadAll());
    return () => {
      source.close();
    };
  }, [loadAll]);

  const copyPrComment = (): void => {
    fetchPrComment()
      .then((markdown) => navigator.clipboard.writeText(markdown))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 4000);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const exportPacket = (): void => {
    window.open('/api/export/evidence-packet?format=html', '_blank');
  };

  const downloadSiem = (): void => {
    setSiemBusy(true);
    setSiemResult(null);
    const params = new URLSearchParams({ format: siemFormat });
    if (siemSince) params.set('since', siemSince);
    if (siemRedact) params.set('redact', 'true');
    fetch(`/api/export/siem?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Export failed (${res.status}).`);
        }
        const count = res.headers.get('x-paqad-event-count') ?? '0';
        const disposition = res.headers.get('content-disposition') ?? '';
        const filename =
          /filename="([^"]+)"/.exec(disposition)?.[1] ?? `paqad-siem-${siemFormat}.txt`;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        setError(null);
        setSiemResult(`Exported ${count} events.`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSiemBusy(false));
  };

  const copyPacketMarkdown = (): void => {
    fetchEvidencePacketMarkdown()
      .then((markdown) => navigator.clipboard.writeText(markdown))
      .then(() => {
        setError(null);
        setPacketCopied(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const downloadAiBom = (): void => {
    if (!aiBom?.document) return;
    const blob = new Blob([JSON.stringify(aiBom.document, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-bom.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const modelsTouched = aiBom?.document?.properties.filter((p) =>
    p.name.startsWith('paqad:authorship:model'),
  );

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-3xl p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">Trust</h1>
          <div className="flex shrink-0 items-baseline gap-3">
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--color-accent)' }}
              onClick={exportPacket}
            >
              Export packet
            </button>
            <button
              type="button"
              className="text-xs"
              style={{ color: 'var(--color-accent)' }}
              onClick={copyPacketMarkdown}
            >
              Copy packet markdown
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
          {PAGE_WHY.trust}
        </p>
        {packetCopied && (
          <div className="mt-3">
            <WinLine onDone={() => setPacketCopied(false)}>
              Copied. Paste it into a PR or a release note.
            </WinLine>
          </div>
        )}

        <details
          className="mt-4 rounded-lg border text-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <summary className="cursor-pointer px-4 py-2 font-medium">Export to your SIEM</summary>
          <div className="border-t px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Project the evidence ledger into the schema your SIEM already ingests. Nothing leaves
              your machine until you download it.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label
                className="flex flex-col gap-1 text-xs"
                style={{ color: 'var(--color-muted)' }}
              >
                Format
                <select
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    background: 'var(--color-canvas)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-canvas-fg)',
                  }}
                  value={siemFormat}
                  onChange={(event) => setSiemFormat(event.target.value as SiemFormatValue)}
                >
                  {SIEM_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="flex flex-col gap-1 text-xs"
                style={{ color: 'var(--color-muted)' }}
              >
                From date
                <input
                  type="date"
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    background: 'var(--color-canvas)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-canvas-fg)',
                  }}
                  value={siemSince}
                  onChange={(event) => setSiemSince(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                onClick={downloadSiem}
                disabled={siemBusy}
              >
                {siemBusy ? 'Exporting…' : 'Download export'}
              </button>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={siemRedact}
                onChange={(event) => setSiemRedact(event.target.checked)}
              />
              <span>
                Redact names and free text
                <span className="block" style={{ color: 'var(--color-muted)' }}>
                  Strips human identities and free-text detail. Use this when you are sharing the
                  export outside your team.
                </span>
              </span>
            </label>
            {siemResult && (
              <div className="mt-3 text-xs" style={{ color: 'var(--color-mod-green)' }}>
                {siemResult}
              </div>
            )}
            <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
              <SavedViewsBar
                area="export"
                getScope={() => ({ format: siemFormat, since: siemSince, redact: siemRedact })}
                onApply={(scope) => {
                  const s = scope as { format?: string; since?: string; redact?: boolean };
                  if (
                    s.format === 'ocsf' ||
                    s.format === 'ecs' ||
                    s.format === 'cef' ||
                    s.format === 'jsonl'
                  ) {
                    setSiemFormat(s.format);
                  }
                  if (typeof s.since === 'string') setSiemSince(s.since);
                  if (typeof s.redact === 'boolean') setSiemRedact(s.redact);
                }}
              />
            </div>
          </div>
        </details>
        {error && (
          <div
            className="mt-4 rounded-lg border p-4 text-sm"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            {error}
          </div>
        )}
        {copied && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: 'var(--color-accent)' }}
            />
            Copied. Paste it on the pull request to show the checks really ran.
          </div>
        )}

        <h2 className="mt-6 text-base font-semibold">Receipts</h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          Who wrote it, who vouched for it, sealed.
        </p>
        {receipts && receipts.receipts.length === 0 && (
          <div
            className="mt-3 rounded-lg border p-6 text-sm"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            Your first receipt appears after your first verified change. It proves who wrote what,
            and that the checks really ran.
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {receipts?.receipts.map((receipt) => (
            <ReceiptCardView
              key={receipt.receipt_hash}
              receipt={receipt}
              onCopy={copyPrComment}
              animateSeal={sealHash !== null && receipt.receipt_hash === sealHash}
            />
          ))}
        </div>

        <h2 className="mt-8 text-base font-semibold">AI bill of materials</h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          Exactly which AI models touched your code.
        </p>
        <div
          className="mt-3 rounded-lg border p-4 text-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {aiBom?.document ? (
            <div className="flex items-center justify-between gap-3">
              <span>
                {aiBom.document.components.length}{' '}
                {aiBom.document.components.length === 1 ? 'file' : 'files'} attested
                {modelsTouched && modelsTouched.length > 0
                  ? ' · ' + modelsTouched.map((p) => p.value).join(', ')
                  : ''}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs"
                style={{ color: 'var(--color-accent)' }}
                onClick={downloadAiBom}
              >
                Download CycloneDX JSON
              </button>
            </div>
          ) : (
            <span style={{ color: 'var(--color-muted)' }}>
              The AI-BOM is generated with your first receipt.
            </span>
          )}
        </div>

        <div className="mt-8 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Evidence timeline</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
              A permanent record no one can quietly rewrite.
            </p>
          </div>
          <select
            className="rounded border px-2 py-1 text-xs"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-canvas-fg)',
            }}
            value={verdictFilter}
            onChange={(event) => setVerdictFilter(event.target.value)}
          >
            <option value="">All verdicts</option>
            <option value="pass">pass</option>
            <option value="fail">fail</option>
            <option value="inconclusive">inconclusive</option>
            <option value="blocked">blocked</option>
          </select>
        </div>
        <div className="mt-2">
          <SavedViewsBar
            area="trust"
            getScope={() => ({ verdict: verdictFilter })}
            onApply={(scope) => {
              const s = scope as { verdict?: string };
              setVerdictFilter(typeof s.verdict === 'string' ? s.verdict : '');
            }}
          />
        </div>
        {evidence && evidence.rows.length === 0 && (
          <div
            className="mt-3 rounded-lg border p-6 text-sm"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            Evidence appears here the first time a verification gate runs.
          </div>
        )}
        {evidence && evidence.rows.length > 0 && (
          <div
            className="mt-3 rounded-lg border px-4 py-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <ul>
              {evidence.rows.map((row) => (
                <EvidenceLine key={row.content_hash + row.ts} row={row} />
              ))}
            </ul>
          </div>
        )}
        {evidence && evidence.rows.length > 0 && evidence.total > evidence.rows.length && (
          <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
            Showing the latest {evidence.rows.length} of {evidence.total} entries.
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}

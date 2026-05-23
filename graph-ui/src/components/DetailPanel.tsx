import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { fetchChunkContent, fetchNodeDetail } from '../lib/api';
import type { NodeDetail } from '../lib/types';

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DetailPanel() {
  const selected = useAppStore((s) => s.selectedNode);
  const detail = useAppStore((s) => s.selectedDetail);
  const loading = useAppStore((s) => s.detailLoading);
  const setDetail = useAppStore((s) => s.setDetail);
  const setDetailLoading = useAppStore((s) => s.setDetailLoading);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchNodeDetail(selected.id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, setDetail, setDetailLoading]);

  if (!selected) return null;

  return (
    <aside
      className="absolute right-3 top-3 w-96 max-h-[calc(100vh-1.5rem)] overflow-auto rounded-lg border p-3 text-sm shadow-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <header>
        <div
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          {selected.type}
        </div>
        <div className="font-medium break-words">{selected.label}</div>
        <div className="text-[10px] break-words" style={{ color: 'var(--color-muted)' }}>
          {selected.id}
        </div>
      </header>

      {loading && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          loading…
        </div>
      )}

      {detail && !loading && (
        <div className="mt-3 space-y-3">
          {selected.type === 'module' && <ModuleDetail detail={detail} />}
          {selected.type === 'file' && <FileDetail detail={detail} />}
          {selected.type === 'chunk' && <ChunkDetail detail={detail} />}
          {selected.type === 'symbol' && <SymbolDetail detail={detail} />}
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span style={{ color: 'var(--color-muted)' }}>{k}</span>
      <span className="text-right break-words">{v}</span>
    </div>
  );
}

function ModuleDetail({ detail }: { detail: NodeDetail }) {
  const attrs = detail.node.attributes;
  return (
    <>
      <section className="space-y-1">
        <Row k="health tier" v={attrs.health_tier ?? '—'} />
        <Row k="defects" v={attrs.defect_count ?? '—'} />
        <Row k="risk floor" v={attrs.risk_floor ?? '—'} />
        <Row k="complexity correction" v={attrs.complexity_correction ?? '—'} />
        <Row k="files" v={detail.children.length} />
      </section>
      <section>
        <div
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          Files
        </div>
        <ul className="mt-1 max-h-48 overflow-auto text-xs">
          {detail.children.slice(0, 200).map((c) => (
            <li key={c.id} className="truncate">
              {c.label}
            </li>
          ))}
          {detail.children.length > 200 && (
            <li style={{ color: 'var(--color-muted)' }}>+{detail.children.length - 200} more…</li>
          )}
        </ul>
      </section>
    </>
  );
}

function FileDetail({ detail }: { detail: NodeDetail }) {
  const a = detail.node.attributes;
  return (
    <>
      <section className="space-y-1">
        <Row k="module" v={detail.parent?.label ?? '(none)'} />
        <Row k="language" v={a.language ?? '—'} />
        <Row k="size" v={fmtBytes(a.size_bytes)} />
        <Row k="symbols" v={a.symbol_count ?? 0} />
        <Row k="chunks" v={detail.children.filter((c) => c.type === 'chunk').length} />
      </section>
      <ImportsSection title="imports → (outgoing)" entries={detail.imports_out ?? []} />
      <ImportsSection title="imports ← (incoming)" entries={detail.imports_in ?? []} />
    </>
  );
}

function ImportsSection({
  title,
  entries,
}: {
  title: string;
  entries: { file_id: string; module_id: string | null }[];
}) {
  if (entries.length === 0) {
    return (
      <section>
        <div
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          {title}
        </div>
        <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
          none
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {title} · {entries.length}
      </div>
      <ul className="mt-1 max-h-48 overflow-auto text-xs">
        {entries.slice(0, 200).map((e) => (
          <li key={e.file_id} className="truncate">
            {e.file_id.replace(/^file:/, '')}
            {e.module_id && (
              <span style={{ color: 'var(--color-muted)' }}>
                {' '}
                · {e.module_id.replace(/^module:/, '')}
              </span>
            )}
          </li>
        ))}
        {entries.length > 200 && (
          <li style={{ color: 'var(--color-muted)' }}>+{entries.length - 200} more…</li>
        )}
      </ul>
    </section>
  );
}

function ChunkDetail({ detail }: { detail: NodeDetail }) {
  const [full, setFull] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const preview = detail.chunk_content_preview ?? '';
  const truncated = detail.chunk_truncated ?? false;
  return (
    <>
      <section className="space-y-1">
        <Row k="file" v={detail.parent?.label ?? '—'} />
        <Row k="index" v={detail.node.attributes.chunk_index ?? '—'} />
        <Row k="ast type" v={detail.node.attributes.ast_node_type ?? '—'} />
        <Row k="hash" v={(detail.node.attributes.content_hash ?? '').slice(0, 12)} />
      </section>
      <section>
        <div
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          Content {truncated && !full && '(first 500 chars)'}
        </div>
        <pre
          className="mt-1 max-h-64 overflow-auto rounded border p-2 text-[11px] leading-snug"
          style={{ background: 'var(--color-canvas)', borderColor: 'var(--color-border)' }}
        >
          {full ?? preview}
        </pre>
        {truncated && !full && (
          <button
            type="button"
            disabled={expanding}
            onClick={async () => {
              setExpanding(true);
              try {
                const r = await fetchChunkContent(detail.node.id);
                setFull(r.content);
              } finally {
                setExpanding(false);
              }
            }}
            className="mt-1 rounded border px-2 py-0.5 text-[11px]"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            {expanding ? 'loading…' : 'show full chunk'}
          </button>
        )}
      </section>
    </>
  );
}

function SymbolDetail({ detail }: { detail: NodeDetail }) {
  return (
    <section className="space-y-1">
      <Row k="file" v={detail.parent?.label ?? '—'} />
      <Row k="exported" v={detail.node.attributes.exported ? 'yes' : 'no'} />
    </section>
  );
}

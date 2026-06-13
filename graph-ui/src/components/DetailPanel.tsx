import { useEffect, useMemo, useState } from 'react';

import { fetchChunkContent, fetchNodeDetail } from '../lib/api';
import { healthLabel } from '../lib/copy';
import { useAppStore } from '../lib/store';
import type { GraphNode, NodeDetail } from '../lib/types';

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Friendly word for each node type — no `file:` / `module:` ids on the card. */
const TYPE_WORD: Record<GraphNode['type'], string> = {
  module: 'Area',
  file: 'File',
  chunk: 'Section',
  symbol: 'Symbol',
};

const TIER_DOT: Record<string, string> = {
  green: 'var(--color-mod-green)',
  amber: 'var(--color-mod-amber)',
  red: 'var(--color-mod-red)',
  unknown: 'var(--color-muted)',
};

/** One plain sentence on why a state reads the way it does. */
const HEALTH_WHY: Record<string, string> = {
  green: 'Checks are passing and nothing is flagged here.',
  amber: 'Some checks are flagged here.',
  red: 'Open risk has been flagged here.',
  unknown: 'This area has not been measured yet.',
};

/** The concrete next action, or "Nothing to do." when healthy. */
const HEALTH_ACTION: Record<string, string> = {
  green: 'Nothing to do.',
  amber: 'Review this area with your team and clear the flagged checks.',
  red: 'Prioritise this area. Open risk needs a fix before more changes land.',
  unknown: 'Run paqad-ai onboard to measure this area.',
};

export function DetailPanel() {
  const selected = useAppStore((s) => s.selectedNode);
  const detail = useAppStore((s) => s.selectedDetail);
  const loading = useAppStore((s) => s.detailLoading);
  const setDetail = useAppStore((s) => s.setDetail);
  const setDetailLoading = useAppStore((s) => s.setDetailLoading);
  const graph = useAppStore((s) => s.graph);

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [graph]);

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
      className="absolute right-3 top-3 w-96 max-h-[calc(100%-1.5rem)] overflow-auto rounded-lg border p-4 text-sm shadow-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <header>
        <div
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          {TYPE_WORD[selected.type]}
        </div>
        <div className="font-medium break-words">{selected.label}</div>
      </header>

      {loading && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          loading…
        </div>
      )}

      {detail && !loading && <PlainCard detail={detail} nodesById={nodesById} />}
    </aside>
  );
}

/** A labelled plain-language section. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </section>
  );
}

/** Climb parent_id to the owning module so files and sections inherit its state. */
function resolveModuleTier(detail: NodeDetail, nodesById: Map<string, GraphNode>): string {
  if (detail.node.type === 'module')
    return (detail.node.attributes.health_tier ?? 'unknown') as string;
  let cursor = nodesById.get(detail.node.id);
  let guard = 0;
  while (cursor && cursor.type !== 'module' && guard < 10) {
    cursor = cursor.parent_id ? nodesById.get(cursor.parent_id) : undefined;
    guard += 1;
  }
  return cursor?.type === 'module'
    ? ((cursor.attributes.health_tier ?? 'unknown') as string)
    : 'unknown';
}

function describeNode(detail: NodeDetail): string {
  const n = detail.node;
  switch (n.type) {
    case 'module': {
      const files = detail.children.length;
      return `An area of your codebase, holding ${files} ${files === 1 ? 'file' : 'files'}.`;
    }
    case 'file': {
      const lang = n.attributes.language ? `${n.attributes.language} ` : '';
      const area = detail.parent?.label ?? 'an unassigned';
      return `A ${lang}source file in the ${area} area.`;
    }
    case 'chunk':
      return `A section of the file ${detail.parent?.label ?? '(unknown)'}.`;
    case 'symbol':
      return `${n.attributes.exported ? 'An exported' : 'An internal'} symbol in ${detail.parent?.label ?? '(unknown)'}.`;
    default:
      return 'Part of your codebase.';
  }
}

function PlainCard({
  detail,
  nodesById,
}: {
  detail: NodeDetail;
  nodesById: Map<string, GraphNode>;
}) {
  const tier = resolveModuleTier(detail, nodesById);
  const isModule = detail.node.type === 'module';

  return (
    <div className="mt-3 space-y-4">
      <Block label="What it is">
        <p>{describeNode(detail)}</p>
      </Block>

      <Block label="How it is doing">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: TIER_DOT[tier] ?? TIER_DOT.unknown }}
          />
          <span className="font-medium">{healthLabel(tier)}</span>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          {HEALTH_WHY[tier] ?? HEALTH_WHY.unknown}
        </p>
      </Block>

      <Block label="What the AI changed">
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Every AI change here is recorded with its verification status.
        </p>
        <button
          type="button"
          className="mt-1 text-xs"
          style={{ color: 'var(--color-accent)' }}
          onClick={() => {
            window.location.hash = '/trust';
          }}
        >
          See the receipts in Trust
        </button>
      </Block>

      <Block label="What to do">
        <p>{HEALTH_ACTION[tier] ?? HEALTH_ACTION.unknown}</p>
      </Block>

      {isModule && (
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
          onClick={() =>
            window.open(
              '/api/snapshot/module/' + encodeURIComponent(detail.node.id),
              '_blank',
              'noopener',
            )
          }
        >
          Share snapshot
        </button>
      )}

      <details className="rounded border pt-0" style={{ borderColor: 'var(--color-border)' }}>
        <summary
          className="cursor-pointer px-2 py-1.5 text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
        >
          For engineers
        </summary>
        <div className="space-y-3 px-2 pb-2">
          <EngineerFields detail={detail} />
        </div>
      </details>
    </div>
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

/** The old spec-sheet, now off by default behind "For engineers". */
function EngineerFields({ detail }: { detail: NodeDetail }) {
  const n = detail.node;
  return (
    <>
      <Row k="id" v={n.id} />
      {n.type === 'module' && <ModuleFields detail={detail} />}
      {n.type === 'file' && <FileFields detail={detail} />}
      {n.type === 'chunk' && <ChunkFields detail={detail} />}
      {n.type === 'symbol' && <SymbolFields detail={detail} />}
    </>
  );
}

function ModuleFields({ detail }: { detail: NodeDetail }) {
  const a = detail.node.attributes;
  return (
    <>
      <Row k="files" v={detail.children.length} />
      <Row k="health tier" v={a.health_tier ?? '—'} />
      <Row k="defects" v={a.defect_count ?? '—'} />
      <Row k="risk floor" v={a.risk_floor ?? '—'} />
      <Row k="complexity correction" v={a.complexity_correction ?? '—'} />
      <div className="mt-1 max-h-40 overflow-auto text-xs">
        {detail.children.slice(0, 200).map((c) => (
          <div key={c.id} className="truncate">
            {c.label}
          </div>
        ))}
      </div>
    </>
  );
}

function FileFields({ detail }: { detail: NodeDetail }) {
  const a = detail.node.attributes;
  return (
    <>
      <Row k="module" v={detail.parent?.label ?? '(none)'} />
      <Row k="language" v={a.language ?? '—'} />
      <Row k="size" v={fmtBytes(a.size_bytes)} />
      <Row k="symbols" v={a.symbol_count ?? 0} />
      <Row k="chunks" v={detail.children.filter((c) => c.type === 'chunk').length} />
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
  if (entries.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {title} · {entries.length}
      </div>
      <ul className="mt-1 max-h-40 overflow-auto text-xs">
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
      </ul>
    </div>
  );
}

function ChunkFields({ detail }: { detail: NodeDetail }) {
  const [full, setFull] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const preview = detail.chunk_content_preview ?? '';
  const truncated = detail.chunk_truncated ?? false;
  return (
    <>
      <Row k="file" v={detail.parent?.label ?? '—'} />
      <Row k="index" v={detail.node.attributes.chunk_index ?? '—'} />
      <Row k="kind" v={detail.node.attributes.ast_node_type ?? '—'} />
      <Row k="hash" v={(detail.node.attributes.content_hash ?? '').slice(0, 12)} />
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
          {expanding ? 'loading…' : 'show full section'}
        </button>
      )}
    </>
  );
}

function SymbolFields({ detail }: { detail: NodeDetail }) {
  return (
    <>
      <Row k="file" v={detail.parent?.label ?? '—'} />
      <Row k="exported" v={detail.node.attributes.exported ? 'yes' : 'no'} />
    </>
  );
}

import { useEffect, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { GraphCanvas } from './components/GraphCanvas';
import { Legend } from './components/Legend';
import { SearchBar } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { fetchGraph } from './lib/api';
import { useAppStore } from './lib/store';

export function App() {
  const graph = useAppStore((s) => s.graph);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const setGraph = useAppStore((s) => s.setGraph);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGraph()
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setGraph, setLoading, setError]);

  const [reloadFlashAt, setReloadFlashAt] = useState<number | null>(null);

  // SSE: refetch graph when the server signals .paqad/ artefacts changed.
  useEffect(() => {
    const source = new EventSource('/api/events');
    const onUpdate = () => {
      fetchGraph()
        .then((g) => {
          setGraph(g);
          setReloadFlashAt(Date.now());
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };
    source.addEventListener('graph-updated', onUpdate);
    return () => {
      source.removeEventListener('graph-updated', onUpdate);
      source.close();
    };
  }, [setGraph, setError]);

  // Clear reload flash after 2.5s
  useEffect(() => {
    if (reloadFlashAt == null) return;
    const t = setTimeout(() => setReloadFlashAt(null), 2500);
    return () => clearTimeout(t);
  }, [reloadFlashAt]);

  return (
    <div className="relative h-full w-full">
      {graph && <GraphCanvas data={graph} />}
      <Sidebar />
      {graph && <SearchBar />}
      <DetailPanel />
      <Legend />
      {(loading || error) && (
        <div
          className="absolute right-3 top-3 rounded border px-3 py-1.5 text-xs shadow-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {loading ? 'Loading graph…' : `Error: ${error}`}
        </div>
      )}
      {reloadFlashAt != null && (
        <div
          className="absolute bottom-3 right-3 rounded border px-3 py-1.5 text-xs shadow-sm"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-accent)',
            color: 'var(--color-accent)',
          }}
        >
          .paqad/ changed · graph reloaded
        </div>
      )}
      {graph && graph.nodes.length === 0 && !loading && (
        <div
          className="absolute inset-0 grid place-items-center text-sm"
          style={{ color: 'var(--color-muted)' }}
        >
          <div
            className="rounded-lg border p-6"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="text-base font-medium">No nodes to display</div>
            <div className="mt-1">
              Run <code>paqad-ai onboard</code> to populate this project's graph.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

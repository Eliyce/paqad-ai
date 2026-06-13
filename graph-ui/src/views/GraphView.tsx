import { useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { DetailPanel } from '../components/DetailPanel';
import { GraphCanvas } from '../components/GraphCanvas';
import { Legend } from '../components/Legend';
import { SearchBar } from '../components/SearchBar';
import { Sidebar } from '../components/Sidebar';
import { fetchDashboard, fetchGraph } from '../lib/api';
import { useAppStore } from '../lib/store';

/**
 * The project graph, now a first-class dashboard area (issue #159). It mounts
 * inside the shared DashboardChrome so it lives behind the same left rail as
 * every other area; its own control panel is an absolutely-positioned floating
 * panel, so it hovers over the canvas rather than the nav rail.
 */
export function GraphView() {
  const graph = useAppStore((s) => s.graph);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const setGraph = useAppStore((s) => s.setGraph);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);

  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

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
    fetchDashboard()
      .then((report) => {
        if (cancelled) return;
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine; the graph error is the one that matters
      });
    return () => {
      cancelled = true;
    };
  }, [setGraph, setLoading, setError]);

  const [reloadFlashAt, setReloadFlashAt] = useState<number | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/events');
    const onUpdate = (): void => {
      fetchGraph()
        .then((g) => {
          setGraph(g);
          setReloadFlashAt(Date.now());
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('graph-updated', onUpdate);
    return () => {
      source.removeEventListener('graph-updated', onUpdate);
      source.close();
    };
  }, [setGraph, setError]);

  useEffect(() => {
    if (reloadFlashAt == null) return;
    const t = setTimeout(() => setReloadFlashAt(null), 2500);
    return () => clearTimeout(t);
  }, [reloadFlashAt]);

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
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
    </DashboardChrome>
  );
}

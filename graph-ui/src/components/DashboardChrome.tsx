import { useEffect, useState } from 'react';

import { fetchApprovals } from '../lib/api';
import { useHashRoute, type Route } from '../lib/router';
import { getThemeMode, setThemeMode } from '../lib/theme';

interface Props {
  projectName: string | null;
  frameworkVersion: string | null;
  sseLive: boolean;
}

/**
 * Top bar — wordmark, project name, theme toggle, nav between
 * Dashboard and Graph, live indicator. Intentionally text-only (no
 * logo asset) per the brief.
 */
export function DashboardChrome({ projectName, frameworkVersion, sseLive }: Props) {
  const { route, navigate } = useHashRoute();
  const [mode, setMode] = useState(() => getThemeMode());
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  // Live badge on the Approvals tab. Re-counts whenever the .paqad/ stream
  // fires, quiet (no badge) at zero.
  useEffect(() => {
    const refresh = (): void => {
      fetchApprovals()
        .then((feed) => setPendingCount(feed.pendingCount))
        .catch(() => setPendingCount(null));
    };
    refresh();
    const source = new EventSource('/api/events');
    source.addEventListener('dashboard-updated', refresh);
    return () => {
      source.close();
    };
  }, []);

  const cycleTheme = (): void => {
    const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light';
    setMode(next);
    setThemeMode(next);
  };

  const navItem = (target: Route, label: string, badge?: number | null): React.ReactNode => (
    <button
      type="button"
      className="rounded px-2 py-1 text-xs"
      style={{
        background: route === target ? 'var(--color-surface)' : 'transparent',
        color: route === target ? 'var(--color-canvas-fg)' : 'var(--color-muted)',
        borderColor: 'var(--color-border)',
        borderWidth: 1,
      }}
      onClick={() => navigate(target)}
    >
      {label}
      {typeof badge === 'number' && badge > 0 && (
        <span
          className="ml-1.5 inline-block rounded-full px-1.5 text-[10px] font-semibold"
          style={{ background: 'var(--color-accent)', color: 'var(--color-canvas)' }}
        >
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <header
      className="flex items-center justify-between gap-4 border-b px-6 py-3 text-sm"
      style={{ background: 'var(--color-canvas)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-semibold">paqad-ai</span>
        <span style={{ color: 'var(--color-muted)' }}>·</span>
        <span>{projectName ?? '(unnamed project)'}</span>
        {frameworkVersion && (
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            v{frameworkVersion}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <nav className="flex gap-1">
          {navItem('dashboard', 'Dashboard')}
          {navItem('approvals', 'Approvals', pendingCount)}
          {navItem('trust', 'Trust')}
          {navItem('graph', 'Graph')}
        </nav>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-muted)',
            background: 'var(--color-surface)',
          }}
          onClick={cycleTheme}
          title={`Theme: ${mode}`}
        >
          ◐ {mode}
        </button>
        <span
          className="flex items-center gap-1 text-xs"
          style={{ color: sseLive ? 'var(--color-mod-green)' : 'var(--color-muted)' }}
          title={sseLive ? 'Live (SSE connected)' : 'Reconnecting'}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: sseLive ? 'var(--color-mod-green)' : 'var(--color-muted)',
            }}
          />
          {sseLive ? 'live' : '…'}
        </span>
      </div>
    </header>
  );
}

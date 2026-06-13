import { useEffect, useState } from 'react';

import { fetchApprovals } from '../lib/api';
import { PAGE_WHY } from '../lib/copy';
import type { DashboardArea } from '../lib/dashboard-types';
import { useHashRoute, type Route } from '../lib/router';
import { getThemeMode, setThemeMode } from '../lib/theme';

import { CommandPalette } from './CommandPalette';

interface Props {
  projectName: string | null;
  frameworkVersion: string | null;
  sseLive: boolean;
  children?: React.ReactNode;
}

const COLLAPSE_KEY = 'paqad-nav-collapsed';

/** Tiny inline icons, 16px, stroke currentColor. No icon library. */
function NavIcon({ name }: { name: DashboardArea }) {
  const paths: Record<DashboardArea, React.ReactNode> = {
    pulse: <path d="M2 8h3l2-4 3 8 2-4h2" />,
    approvals: <path d="M2 9l3 3 4-4M2 5h12M9 9h5M9 13h5" transform="translate(0 -1)" />,
    trust: <path d="M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2z" />,
    build: <path d="M8 2l5 3v6l-5 3-5-3V5l5-3zM8 8l5-3M8 8L3 5M8 8v6" />,
    graph: (
      <path d="M4 4a1.5 1.5 0 1 0 0-.01M12 4a1.5 1.5 0 1 0 0-.01M8 13a1.5 1.5 0 1 0 0-.01M4.8 4.8l2.4 7M11.2 4.8l-2.4 7M5 4h6" />
    ),
    automation: <path d="M3 6a5 5 0 0 1 9-2m1 6a5 5 0 0 1-9 2M12 1v3H9M4 15v-3h3" />,
    knowledge: <path d="M3 3a3 3 0 0 1 5 1 3 3 0 0 1 5-1v9a3 3 0 0 0-5 1 3 3 0 0 0-5-1V3z" />,
    setup: <path d="M3 5h10M3 11h10M6 3v4M11 9v4" />,
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * App shell (issue #146): a quiet left sidebar with the seven areas,
 * collapsible to icons, with the live indicator and theme toggle in the
 * footer. Content renders to the right via children. Dimmer than the
 * content, spacing over borders.
 */
export function DashboardChrome({ projectName, frameworkVersion, sseLive, children }: Props) {
  const { route, navigate } = useHashRoute();
  const [mode, setMode] = useState(() => getThemeMode());
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Live badge on the Approvals entry. Re-counts whenever the .paqad/
  // stream fires, quiet (no badge) at zero.
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

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // private mode; the toggle still works for this session
      }
      return next;
    });
  };

  const cycleTheme = (): void => {
    const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light';
    setMode(next);
    setThemeMode(next);
  };

  // Sub-pages highlight their parent area: the delivery-policy editor
  // lives under Automation, the instructions and design-token editors
  // under Knowledge, the module map under Build.
  const PARENT_AREA: Partial<Record<Route, Route>> = {
    'delivery-policy': 'automation',
    instructions: 'knowledge',
    'design-tokens': 'knowledge',
    'module-map': 'build',
  };
  const activeRoute: Route = PARENT_AREA[route] ?? route;

  const navItem = (target: Route & DashboardArea, label: string, badge?: number | null) => {
    const active = activeRoute === target;
    return (
      <button
        key={target}
        type="button"
        title={PAGE_WHY[target]}
        aria-current={active ? 'page' : undefined}
        className={
          'relative flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-secondary ' +
          (collapsed ? 'justify-center' : '')
        }
        style={{
          background: active ? 'var(--color-surface)' : 'transparent',
          color: active ? 'var(--color-canvas-fg)' : 'var(--color-muted)',
        }}
        onClick={() => navigate(target)}
      >
        <NavIcon name={target} />
        {!collapsed && <span className="truncate">{label}</span>}
        {typeof badge === 'number' && badge > 0 && (
          <span
            className={
              'inline-block rounded-full px-1.5 text-[10px] font-semibold ' +
              (collapsed ? 'absolute' : 'ml-auto')
            }
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-canvas)',
              ...(collapsed ? { transform: 'translate(10px, -8px)' } : {}),
            }}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{ background: 'var(--color-canvas)', color: 'var(--color-canvas-fg)' }}
    >
      <aside
        className={'flex shrink-0 flex-col px-3 py-4 ' + (collapsed ? 'w-[60px]' : 'w-[216px]')}
        style={{
          background: 'var(--color-canvas)',
          borderRight: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        }}
      >
        <div className={'flex items-center gap-2 px-1 ' + (collapsed ? 'justify-center' : '')}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-secondary font-semibold">paqad-ai</div>
              <div className="truncate text-caption" style={{ color: 'var(--color-muted)' }}>
                {projectName ?? '(unnamed project)'}
                {frameworkVersion ? ' · v' + frameworkVersion : ''}
              </div>
            </div>
          )}
          <button
            type="button"
            className="rounded-[6px] p-1.5"
            style={{ color: 'var(--color-muted)' }}
            title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            onClick={toggleCollapsed}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {collapsed ? <path d="M5 3l4 4-4 4" /> : <path d="M9 3L5 7l4 4" />}
            </svg>
          </button>
        </div>
        <nav className="mt-5 flex flex-col gap-0.5">
          {navItem('pulse', 'Pulse')}
          {navItem('approvals', 'Approvals', pendingCount)}
          {navItem('trust', 'Trust')}
          {navItem('build', 'Build')}
          {navItem('graph', 'Graph')}
          {navItem('automation', 'Automation')}
          {navItem('knowledge', 'Knowledge')}
          {navItem('setup', 'Setup')}
        </nav>
        <div
          className={
            'mt-auto flex items-center gap-2 px-1 pt-4 ' +
            (collapsed ? 'flex-col justify-center' : '')
          }
        >
          <button
            type="button"
            className="rounded-[6px] px-2 py-1 text-caption"
            style={{ color: 'var(--color-muted)' }}
            onClick={cycleTheme}
            title={'Theme: ' + mode}
          >
            ◐{!collapsed && ' ' + mode}
          </button>
          <span
            className={'flex items-center gap-1 text-caption ' + (collapsed ? '' : 'ml-auto')}
            style={{ color: sseLive ? 'var(--color-mod-green)' : 'var(--color-muted)' }}
            title={sseLive ? 'Live (SSE connected)' : 'Reconnecting'}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: sseLive ? 'var(--color-mod-green)' : 'var(--color-muted)' }}
            />
            {!collapsed && (sseLive ? 'live' : '…')}
          </span>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}

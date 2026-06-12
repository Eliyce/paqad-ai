import { useEffect, useState } from 'react';

/**
 * The set of routes the SPA understands. The default route is `pulse`
 * — the comprehension-layer home (issue #146). `#/dashboard` keeps
 * working as the legacy full-status view; `paqad-ai graph` opens the
 * SPA at /#/graph so its muscle-memory shortcut keeps working.
 */
export type Route =
  | 'pulse'
  | 'approvals'
  | 'trust'
  | 'build'
  | 'automation'
  | 'knowledge'
  | 'setup'
  | 'graph'
  | 'dashboard';

const ROUTES: ReadonlySet<Route> = new Set<Route>([
  'pulse',
  'approvals',
  'trust',
  'build',
  'automation',
  'knowledge',
  'setup',
  'graph',
  'dashboard',
]);

function parseHash(hash: string): Route {
  // Strip leading '#' and any leading '/'.
  const cleaned = hash.replace(/^#\/?/, '').split(/[?#]/)[0] ?? '';
  if (ROUTES.has(cleaned as Route)) return cleaned as Route;
  return 'pulse';
}

/**
 * Tiny hash router. Returns the current `Route` and a navigate helper —
 * deliberately not pulling react-router in for a two-route SPA.
 */
export function useHashRoute(): { route: Route; navigate: (route: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (next: Route): void => {
    window.location.hash = `/${next}`;
  };

  return { route, navigate };
}

import { useEffect, useState } from 'react';

/**
 * The set of routes the SPA understands. The default route is `dashboard`
 * — the new entry point. `paqad-ai graph` opens the SPA at /#/graph so
 * its muscle-memory shortcut keeps working.
 */
export type Route = 'dashboard' | 'graph' | 'approvals' | 'trust';

const ROUTES: ReadonlySet<Route> = new Set<Route>(['dashboard', 'graph', 'approvals', 'trust']);

function parseHash(hash: string): Route {
  // Strip leading '#' and any leading '/'.
  const cleaned = hash.replace(/^#\/?/, '').split(/[?#]/)[0] ?? '';
  if (ROUTES.has(cleaned as Route)) return cleaned as Route;
  return 'dashboard';
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

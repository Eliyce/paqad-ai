import { useEffect, useState } from 'react';

export type Route =
  | 'pulse'
  | 'approvals'
  | 'trust'
  | 'build'
  | 'automation'
  | 'knowledge'
  | 'setup'
  | 'graph'
  | 'dashboard'
  | 'delivery-policy'
  | 'instructions'
  | 'module-map'
  | 'site-map'
  | 'design-tokens';

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
  'delivery-policy',
  'instructions',
  'module-map',
  'site-map',
  'design-tokens',
]);

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '').split(/[?#]/)[0] ?? '';
  if (ROUTES.has(cleaned as Route)) return cleaned as Route;
  return 'pulse';
}

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

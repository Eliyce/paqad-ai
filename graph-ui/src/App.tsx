import { useHashRoute } from './lib/router';
import { DashboardView } from './views/DashboardView';
import { GraphView } from './views/GraphView';

/**
 * SPA shell. The hash router picks the active view; both views share the
 * same design tokens and the same /api/events SSE stream — see
 * lib/router.ts for the route set.
 */
export function App() {
  const { route } = useHashRoute();
  if (route === 'graph') return <GraphView />;
  return <DashboardView />;
}

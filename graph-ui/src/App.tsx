import { useHashRoute } from './lib/router';
import { ApprovalsView } from './views/ApprovalsView';
import { DashboardView } from './views/DashboardView';
import { GraphView } from './views/GraphView';
import { TrustView } from './views/TrustView';

/**
 * SPA shell. The hash router picks the active view; all views share the
 * same design tokens and the same /api/events SSE stream — see
 * lib/router.ts for the route set.
 */
export function App() {
  const { route } = useHashRoute();
  if (route === 'graph') return <GraphView />;
  if (route === 'approvals') return <ApprovalsView />;
  if (route === 'trust') return <TrustView />;
  return <DashboardView />;
}

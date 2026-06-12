import { useHashRoute } from './lib/router';
import { ApprovalsView } from './views/ApprovalsView';
import { AreaView } from './views/AreaView';
import { DashboardView } from './views/DashboardView';
import { DeliveryPolicyView } from './views/DeliveryPolicyView';
import { DesignTokensView } from './views/DesignTokensView';
import { GraphView } from './views/GraphView';
import { InstructionsView } from './views/InstructionsView';
import { KnowledgeRagPanel } from './views/KnowledgeRagPanel';
import { ModuleMapView } from './views/ModuleMapView';
import { SetupView } from './views/SetupView';
import { PulseView } from './views/PulseView';
import { TrustView } from './views/TrustView';

/**
 * SPA shell. The hash router picks the active view; all views share the
 * same design tokens and the same /api/events SSE stream — see
 * lib/router.ts for the route set. Pulse is home; `#/dashboard` keeps
 * serving the legacy full-status view; the graph stays full-bleed.
 */
export function App() {
  const { route } = useHashRoute();
  if (route === 'graph') return <GraphView />;
  if (route === 'approvals') return <ApprovalsView />;
  if (route === 'trust') return <TrustView />;
  if (route === 'dashboard') return <DashboardView />;
  if (route === 'build') return <AreaView key="build" area="build" title="Build" />;
  if (route === 'automation')
    return <AreaView key="automation" area="automation" title="Automation" />;
  if (route === 'delivery-policy') return <DeliveryPolicyView />;
  if (route === 'instructions') return <InstructionsView />;
  if (route === 'module-map') return <ModuleMapView />;
  if (route === 'design-tokens') return <DesignTokensView />;
  if (route === 'knowledge')
    return (
      <AreaView key="knowledge" area="knowledge" title="Knowledge" extra={<KnowledgeRagPanel />} />
    );
  if (route === 'setup') return <SetupView />;
  return <PulseView />;
}

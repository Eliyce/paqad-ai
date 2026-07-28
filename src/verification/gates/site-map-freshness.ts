import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { collectStaleSiteMapViews } from '@/site-map/publish.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

/**
 * Keep the published site map honest: a code change that drifts the map cannot reach
 * "Safe to merge" while the map is stale. Mirror of {@link DocumentationFreshnessGate}, but
 * over the site-map progress ledger instead of the canonical docs.
 *
 * Inert unless the `site_map` capability is enabled (INV-1): with the flag off — the default —
 * the gate always passes and changes nothing, so it is fully additive.
 */
export class SiteMapFreshnessGate implements Gate {
  readonly gate = 'site-map-freshness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    if (!resolveFrameworkConfig(context.project_root).features.site_map) {
      return createPass(this.gate, 'Site map capability is off');
    }

    if (!context.code_changed) {
      return createPass(this.gate, 'No code change to drift the site map');
    }

    const staleViews = await collectStaleSiteMapViews(context.project_root);
    if (staleViews.length > 0) {
      return createFail(
        this.gate,
        `Site map is stale for changed code: ${staleViews.join(', ')}`,
        'Hit Run on the Site map area of `paqad-ai dashboard` to refresh the map before treating the change as complete.',
      );
    }

    return createPass(this.gate, 'Site map is current');
  }
}

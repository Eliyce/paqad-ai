import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { isStale } from '@/site-map/freshness.js';
import { collectStaleSiteMapViews } from '@/site-map/publish.js';
import { readCanonicalSiteMap } from '@/site-map/store.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

/** The remediation both stale-map failures share: refresh the map from the dashboard. */
const REFRESH_REMEDIATION =
  'Hit Run on the Site map area of `paqad-ai dashboard` to refresh the map before treating the change as complete.';

/**
 * Keep the published site map honest: a code change that drifts the map cannot reach
 * "Safe to merge" while the map is stale. Mirror of {@link DocumentationFreshnessGate}, but
 * over the site map instead of the canonical docs. Two complementary staleness signals fire,
 * both behind the code-change guard:
 *
 * 1. The site-map progress ledger's published-view source files re-hash differently than when
 *    they were last published (current-change drift; the report machinery C8 retires).
 * 2. The stored canonical map carries a stamped {@link AppFreshness} whose cited `file:line`
 *    anchors no longer all resolve (recorded map-vs-code drift, issue #466 Part G). This is read
 *    STATICALLY from the stored map — no evidence resolution at gate time (NFR-4) — and stays
 *    inert until C8 wires the live `sitemap` verb to stamp it, so it is fully additive today.
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
        REFRESH_REMEDIATION,
      );
    }

    const storedMap = readCanonicalSiteMap(context.project_root);
    const freshness = storedMap?.app.freshness;
    if (freshness !== undefined && isStale(freshness)) {
      return createFail(
        this.gate,
        `Site map has drifted from code: ${freshness.anchors_broken} of ${freshness.anchors_total} cited anchors no longer resolve`,
        REFRESH_REMEDIATION,
      );
    }

    return createPass(this.gate, 'Site map is current');
  }
}

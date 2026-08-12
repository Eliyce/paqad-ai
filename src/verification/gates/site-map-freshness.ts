import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { isStale } from '@/site-map/freshness.js';
import { readCanonicalSiteMap } from '@/site-map/store.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

/** The remediation a stale map shares with the dashboard copy: refresh it from the Site map area. */
const REFRESH_REMEDIATION =
  'Hit Run on the Site map area of `paqad-ai dashboard` to refresh the map before treating the change as complete.';

/**
 * Keep the stored site map honest: a code change that drifts the map cannot reach
 * "Safe to merge" while the map is stale. Mirror of {@link DocumentationFreshnessGate}, but
 * over the site map instead of the canonical docs. One deterministic signal fires, behind the
 * code-change guard: the stored canonical map carries a stamped {@link AppFreshness} whose
 * cited `file:line` anchors no longer all resolve (recorded map-vs-code drift, issue #466
 * Part G). It is read STATICALLY from the stored map — no evidence resolution at gate time
 * (NFR-4) — and stamped by the live run's trust + freshness restamp (C8), so the gate only
 * ever grades earned proof. (The old progress-ledger published-view signal is retired with the
 * report machinery, ART-3.)
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

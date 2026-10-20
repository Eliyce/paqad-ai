import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { isStale } from '@/site-map/freshness.js';
import { readCanonicalSiteMap } from '@/site-map/store.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

const REFRESH_REMEDIATION =
  'Hit Run on the Site map area of `paqad-ai dashboard` to refresh the map before treating the change as complete.';

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

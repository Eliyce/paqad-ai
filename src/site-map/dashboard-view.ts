import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type { AppMap, Journey } from '@/core/types/site-map.js';

import { isStale } from './freshness.js';
import {
  detectSiteMapPrerequisites,
  type MissingSiteMapPrerequisite,
  type SiteMapPrerequisites,
} from './prerequisites.js';
import { readSiteMapLayout, type SiteMapStoredLayout } from './layout-store.js';
import { readAllJourneys, readCanonicalSiteMap } from './store.js';

export interface SiteMapFreshness {
  generated_from: string | null;
  anchors_total: number | null;
  anchors_resolved: number | null;
  anchors_broken: number | null;
  stale: boolean;
}

function freshnessOf(map: AppMap): SiteMapFreshness {
  const stamped = map.app.freshness;
  return {
    generated_from: map.app.generated_from ?? null,
    anchors_total: stamped?.anchors_total ?? null,
    anchors_resolved: stamped?.anchors_resolved ?? null,
    anchors_broken: stamped?.anchors_broken ?? null,
    stale: stamped === undefined ? false : isStale(stamped),
  };
}

export type SiteMapView =
  | { status: 'disabled' }
  | {
      status: 'blocked';
      missing: MissingSiteMapPrerequisite[];
      prerequisites: SiteMapPrerequisites;
    }
  | { status: 'empty' }
  | {
      status: 'ready';
      map: AppMap;
      journeys: Journey[];
      freshness: SiteMapFreshness;
      layout: SiteMapStoredLayout | null;
      readOnly: boolean;
    };

export function buildSiteMapView(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { readOnly?: boolean } = {},
): SiteMapView {
  if (!resolveFrameworkConfig(projectRoot, env).features.site_map) {
    return { status: 'disabled' };
  }

  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) {
    const prerequisites = detectSiteMapPrerequisites(projectRoot);
    if (!prerequisites.satisfied) {
      return { status: 'blocked', missing: prerequisites.missing, prerequisites };
    }
    return { status: 'empty' };
  }

  return {
    status: 'ready',
    map,
    journeys: readAllJourneys(projectRoot),
    freshness: freshnessOf(map),
    layout: readSiteMapLayout(projectRoot),
    readOnly: options.readOnly === true,
  };
}

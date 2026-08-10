// The static payload the dashboard renders as the interactive visual site map (issue #466).
// This is the whole "data reaches the browser" seam: the full AI-authored map (surfaces,
// transitions, areas, actors, guards, and the per-journey step detail) is read from the single
// canonical `docs/site-map/` YML and handed to the client as-is. Nothing here calls an LLM, so
// the dashboard is static and reproducible (NFR-4, NFR-5): the same YML always yields the same
// payload. When the `site_map` flag is off the payload is inert (INV-1, NFR-3).

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type { AppMap, Journey } from '@/core/types/site-map.js';

import { isStale } from './freshness.js';
import {
  detectSiteMapPrerequisites,
  type MissingSiteMapPrerequisite,
  type SiteMapPrerequisites,
} from './prerequisites.js';
import { readAllCanonicalJourneys, readCanonicalSiteMap } from './store.js';

/**
 * How fresh the map is, so the viewer can judge whether to trust it (FRESH-1). The anchor counts and
 * the derived `stale` flag come straight from the freshness the write path stamped into the stored
 * map, so the dashboard resolves nothing at view time (NFR-4). They are `null` until the map has been
 * verified at least once (an authored-but-never-verified map has no stamped freshness), in which case
 * `stale` reads false — nothing has been shown to be broken yet.
 */
export interface SiteMapFreshness {
  /** The code state the map was authored against (a commit ref), or null when unstated. */
  generated_from: string | null;
  /** Distinct cited `file:line` anchors, or null before the map has been verified. */
  anchors_total: number | null;
  /** How many of those anchors still resolve, or null before verification. */
  anchors_resolved: number | null;
  /** How many no longer resolve, or null before verification. */
  anchors_broken: number | null;
  /** True when at least one cited anchor is broken (the map has drifted from code). */
  stale: boolean;
}

/** Project the stored map's freshness into the static dashboard payload (no resolution at view time). */
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

/**
 * The dashboard's view of the site map. A discriminated union so the client renders exactly one
 * honest state and never a map with no basis:
 *  - `disabled`  — the `site_map` flag is off; nothing is served (INV-1).
 *  - `blocked`   — the flag is on but the documentation family it depends on is missing, so creation
 *                  cannot run; `missing` names exactly which of `create documentation` /
 *                  `create module documentation` to run first (FR-5, PRE-2..5).
 *  - `empty`     — the flag is on and the prerequisites are met, but no map has been authored yet.
 *  - `ready`     — the full map plus its journeys, read statically from the canonical YML.
 */
export type SiteMapView =
  | { status: 'disabled' }
  | {
      status: 'blocked';
      missing: MissingSiteMapPrerequisite[];
      prerequisites: SiteMapPrerequisites;
    }
  | { status: 'empty' }
  | { status: 'ready'; map: AppMap; journeys: Journey[]; freshness: SiteMapFreshness };

/**
 * Build the static site-map payload for the dashboard. Reads only the stored canonical artifact
 * (`docs/site-map/app-map.yaml` + `journeys/*.journey.yaml`); it never runs the model, so it is
 * safe to call on every dashboard poll.
 */
export function buildSiteMapView(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): SiteMapView {
  if (!resolveFrameworkConfig(projectRoot, env).features.site_map) {
    return { status: 'disabled' };
  }

  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) {
    // No map authored yet. Distinguish "cannot be created" from "ready to create": if the
    // documentation family it depends on is missing, say so and name what to run (FR-5). Only
    // when the prerequisites are met is the empty "ask paqad to create it" state honest. An
    // already-authored map keeps rendering even if the prerequisites later go missing; surfacing
    // that as a stale-foundation signal (PRE-8) belongs to the proof/living-doc commits.
    const prerequisites = detectSiteMapPrerequisites(projectRoot);
    if (!prerequisites.satisfied) {
      return { status: 'blocked', missing: prerequisites.missing, prerequisites };
    }
    return { status: 'empty' };
  }

  return {
    status: 'ready',
    map,
    journeys: readAllCanonicalJourneys(projectRoot),
    freshness: freshnessOf(map),
  };
}

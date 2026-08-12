// Deterministic prerequisite detection for site-map creation (issue #466, Part A.0 / PRE-1..12).
//
// The site map is the third stage of the same documentation family as `create documentation`
// and `create module documentation`. It reads the business terms and module structure those two
// stages produce, so creating it depends on them (PRE-9). This module answers the one question the
// tool can decide on its own, with no model call (PRE-7): have those two prerequisites been met?
//
// It composes the two existing readers rather than re-deriving anything:
//  - the module-map reader (from the module-map reconciler) is the `create documentation` signal:
//    that foundation stage writes docs/instructions/rules/module-map.yml (the map is written before
//    `create module documentation` can run — see src/document/workflow.ts).
//  - the module-docs collector is the `create module documentation` signal: it counts declared
//    modules that carry docs/modules/<slug>/index/summary.md, the per-module doc that stage writes.
//
// The block is intentionally narrow (PRE-2, PRE-12, owner decision Q6): it fires only when the
// documentation foundation is absent, or when the foundation exists but NO module is documented at
// all. Partial module coverage does not block; the creation flow marks undocumented-module surfaces
// low-confidence and raises a finding instead (a later commit).

import { collectModuleDocs } from '@/dashboard/collectors/module-docs.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';

/** The two documentation-family workflows site-map creation depends on, named exactly as the
 *  person invokes them so there is no guesswork about what to run (PRE-5). */
export type SiteMapPrerequisiteWorkflow = 'create documentation' | 'create module documentation';

/** One unmet prerequisite: the exact workflow to run, plus a plain-language reason it matters. */
export interface MissingSiteMapPrerequisite {
  /** The workflow the person runs to satisfy this prerequisite (PRE-5). */
  workflow: SiteMapPrerequisiteWorkflow;
  /** Why the map needs it (PRE-6), in the project voice: plain language, no jargon, no em dashes. */
  reason: string;
}

/** The deterministic counts behind the decision, so the UI and later stages can be specific. */
export interface SiteMapPrerequisiteStatus {
  /** True when docs/instructions/rules/module-map.yml exists (the `create documentation` output). */
  foundation_present: boolean;
  /** How many modules the map declares (0 when the map is absent). */
  module_count: number;
  /** Declared modules carrying docs/modules/<slug>/index/summary.md (`create module documentation`). */
  documented_module_count: number;
}

/** Whether site-map creation may proceed, and if not, exactly which workflow(s) to run first. */
export interface SiteMapPrerequisites {
  /** True when creation may proceed: the foundation exists and either there are no modules or at
   *  least one is documented. Empty `missing` iff this is true. */
  satisfied: boolean;
  /** Unmet prerequisites, in dependency order (the foundation before module docs). */
  missing: MissingSiteMapPrerequisite[];
  status: SiteMapPrerequisiteStatus;
}

const FOUNDATION_MISSING: MissingSiteMapPrerequisite = {
  workflow: 'create documentation',
  reason:
    "The map uses the business terms and module structure from your project's documentation, so it needs the documentation foundation first.",
};

const MODULE_DOCS_MISSING: MissingSiteMapPrerequisite = {
  workflow: 'create module documentation',
  reason:
    'The map groups screens by module and labels them from the module docs, so it needs your modules documented first.',
};

/**
 * Decide, deterministically, whether the site map can be created for this project (PRE-1, PRE-7).
 * Never runs the model and never writes anything, so it is safe to call on every dashboard poll.
 */
export function detectSiteMapPrerequisites(projectRoot: string): SiteMapPrerequisites {
  const map = readRawModuleMap(projectRoot);

  // PRE-2: the documentation foundation is absent. Stop before any mapping work and name the one
  // workflow that produces it (PRE-4, PRE-5). Module docs cannot exist without it, so it is the
  // only actionable next step.
  if (map === null) {
    return {
      satisfied: false,
      missing: [FOUNDATION_MISSING],
      status: { foundation_present: false, module_count: 0, documented_module_count: 0 },
    };
  }

  const moduleCount = map.modules.length;
  const documentedModuleCount = countDocumentedModules(projectRoot);

  // PRE-2 / PRE-12 (owner decision Q6): block only when the foundation exists but there is no
  // module documentation at all. A project with zero declared modules has nothing to document, so
  // it does not block here; partial coverage proceeds and raises findings on the undocumented gaps.
  if (moduleCount > 0 && documentedModuleCount === 0) {
    return {
      satisfied: false,
      missing: [MODULE_DOCS_MISSING],
      status: { foundation_present: true, module_count: moduleCount, documented_module_count: 0 },
    };
  }

  return {
    satisfied: true,
    missing: [],
    status: {
      foundation_present: true,
      module_count: moduleCount,
      documented_module_count: documentedModuleCount,
    },
  };
}

/** How many declared modules have a per-module summary, read via the module-docs collector. */
function countDocumentedModules(projectRoot: string): number {
  const present = collectModuleDocs(projectRoot).details?.['present'];
  return typeof present === 'number' ? present : 0;
}

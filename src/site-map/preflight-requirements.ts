// The site-map workflow's preflight requirement list (issue: site-map rebuild S3b, fixing D5/D6).
//
// S3a ships this as an empty typed stub so the generic registry can already map `site-map` to a
// requirement list without the runner knowing anything site-map-specific. S3b fills it with the
// real requirements and their read-only probes.

import type { PreflightRequirement } from '@/workflow-preflight/contract.js';

/** The requirements the site-map workflow checks before it runs. Filled in S3b. */
export const siteMapPreflightRequirements: PreflightRequirement[] = [];
